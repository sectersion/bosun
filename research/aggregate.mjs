// Aggregate the live capture into a movement spec. usage: node aggregate.mjs capture-1.jsonl
import { readFileSync, writeFileSync } from "node:fs";
import { decompressFrame } from "../lib/lz4.js";
import { TYPE, decode } from "../lib/proto.js";

const lines = readFileSync(process.argv[2] || "capture-1.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const NAME = Object.fromEntries(Object.entries(TYPE).map(([n, id]) => [id, n]));
const WORLD_SENTINEL = 2 ** 48 - 1;
const open = lines.filter((l) => l.dir === "open" && /wss:\/\/api/.test(l.url)).pop();
let key = null; const ev = [];
for (const f of lines.filter((l) => l.b && l.t >= open.t)) {
  const raw = b64(f.b);
  if (f.dir === "d") {
    let o; try { o = decompressFrame(raw); } catch { continue; }
    if (!key) { key = o.subarray(8); continue; }
    let m; try { m = decode(o[0], o.subarray(1)); } catch {}
    ev.push({ t: f.t, dir: "d", name: NAME[o[0]] || `#${o[0]}`, m });
  } else {
    const o = Uint8Array.from(raw.map((x, i) => x ^ key[i % key.length]));
    let m; try { m = decode(o[0], new Uint8Array(o.slice(1))); } catch {}
    ev.push({ t: f.t, dir: "u", name: NAME[o[0]] || `#${o[0]}`, m });
  }
}
writeFileSync("decoded-session.jsonl", ev.map((e) => JSON.stringify(e)).join("\n"));
const self = ev.find((e) => e.name === "ResetYourState")?.m?.yourTank;
const up = ev.filter((e) => e.dir === "u");
const pct = (n) => (100 * n).toFixed(1) + "%";

// ---- self echoes over time (server truth) ----
const echo = [];
for (const e of ev) if (e.name === "WorldMessage" && e.m?.tanks) {
  const tk = e.m.tanks.find((t) => t.id === self.id);
  if (tk && tk.x != null && tk.z != null) echo.push({ t: e.t, x: tk.x, y: tk.y, z: tk.z, anim: tk.animationState, rotY: tk.rotationY, relTo: tk.relativeToId, interp: tk.interpolationIndex, v: tk.vehiclePositionIndex });
}
// ---- claims ----
const claims = up.filter((e) => e.name === "MyTankMessage" && e.m?.x != null);
// mode timeline from echoes: aboard(ship relTo set & != sentinel) vs world
const modeOf = (e) => (e.relTo != null && e.relTo !== WORLD_SENTINEL && e.relTo !== 0 ? "aboard:" + e.relTo : "world");
const segs = []; let cur = null;
for (const e of echo) {
  if (!cur || cur.mode !== modeOf(e)) { cur = { mode: modeOf(e), t0: e.t, n: 0, maxStep: 0, sample: [] }; segs.push(cur); }
  const p = cur.sample.at(-1); if (p) cur.maxStep = Math.max(cur.maxStep, Math.hypot(e.x - p.x, e.z - p.z));
  cur.sample.push(e); cur.n++;
}
console.log(`frames:${ev.length} self:${self.username}(${self.id}) echoes:${echo.length} claims:${claims.length} -> decoded-session.jsonl saved`);
console.log("\n== segments (server-observed modes) ==");
for (const s of segs.filter((x) => x.n > 2).slice(0, 25))
  console.log(`  ${modeOf({ relTo: +s.mode.split(":")[1] ?? 0 }) === "world" ? "ON-FOOT      " : "aboard ship    "} +${((s.t0 - ev[0].t) / 1000).toFixed(0).padStart(4)}s n=${String(s.n).padStart(4)} maxStep=${s.maxStep.toFixed(2)} anim=${[...new Set(s.sample.map(e => e.anim).filter(v=>v!=null))].slice(0,6).join("/")} vPos=${[...new Set(s.sample.map(e=>e.v).filter(v=>v!=null))].slice(0,4).join("/")}`);

// ---- speed by mode ----
const stat = (arr) => { if (!arr.length) return "n=0"; arr.sort((a, b) => a - b);
  return `n=${arr.length} med=${arr[(arr.length / 2) | 0].toFixed(1)} p90=${arr[(arr.length * 0.9) | 0].toFixed(1)} max=${arr.at(-1).toFixed(1)} u/s`; };
const speeds = { foot: [], aboard: [] };
for (let i = 1; i < echo.length; i++) {
  const a = echo[i - 1], b = echo[i];
  if (b.t - a.t > 500) continue; const dt = (b.t - a.t) / 1000;
  const v = Math.hypot(b.x - a.x, b.z - a.z) / dt;
  if (!(v > 0 && v < 200)) continue;
  (modeOf(b) === "world" ? speeds.foot : speeds.aboard).push(v);
}
console.log("\n== server-observed speed ==");
console.log("  on-foot:", stat(speeds.foot.filter((v) => v > 0.2)));
console.log("  aboard :", stat(speeds.aboard.filter((v) => v > 0.2)));

// ---- claims-vs-echoes: latency & residual of server relay of claimed positions ----
const resid = [];
for (const c of claims) {
  if (!c.m || c.m.relativeToId != null && c.m.relativeToId !== WORLD_SENTINEL) continue; // world-frame claims only
  const e = echo.find((x) => x.t >= c.t && x.t <= c.t + 400 && (x.relTo == null || x.relTo === WORLD_SENTINEL));
  if (!e) continue;
  resid.push({ d: Math.hypot(c.m.x - e.x, c.m.z - e.z), dt: e.t - c.t });
}
const ds = resid.map((r) => r.d).sort((a, b) => a - b);
const med = ds.length ? ds[(ds.length / 2) | 0].toFixed(3) : "-";
const p90 = ds.length ? ds[((ds.length * 0.9) | 0)].toFixed(3) : "-";
const lag = resid.map((r) => r.dt).sort((a, b) => a - b);
console.log("\n== claim(x,z) vs next server echo of self ==");
console.log(`  comparable pairs: ${resid.length}  |claim-echo| med=${med} p90=${p90} max=${ds.length ? ds.at(-1).toFixed(3) : "-"}`);
console.log(`  echo lag: med=${lag.length ? lag[(lag.length / 2) | 0].toFixed(0) : "-"}ms`);

// ---- interpolationIndex semantics ----
const iIdx = claims.map((c) => c.m.interpolationIndex).filter((v) => v != null);
const seen = [...new Set(iIdx)];
console.log(`\ninterpolationIndex(uplink): distinct=${seen.length} range=${Math.min(...seen)}..${Math.max(...seen)} first12=${seen.slice(0, 12).join(",")}`);
const eIdx = echo.map((e) => e.interp).filter((v) => v != null);
console.log(`interpolationIndex(self echo): distinct=${new Set(eIdx).size} first12=${[...new Set(eIdx)].slice(0, 12).join(",")}`);

// ---- anim states observed + transitions ----
const anims = [...new Set([...echo.map((e) => e.anim), ...claims.map((c) => c.m.animationState)].filter((v) => v != null))].sort((a, b) => a - b);
console.log("animationState values seen:", anims.join(","));

// interpolationIndex sequence sample
const seq = up.filter((e) => e.name === "MyTankMessage").map((e) => e.m.interpolationIndex).filter((v) => v != null);
console.log("\ninterp seq sample:", seq.slice(0, 40).join(","));

// velocity-envelope test: for each claim, claim-speed vs |claim-echo| residual
const envelope = [];
let cp = null;
for (const c of claims) {
  if (cp && c.t - cp.t < 400 && (c.m.relativeToId ?? 0) === (cp.m.relativeToId ?? 0)) {
    const v = Math.hypot(c.m.x - cp.m.x, c.m.z - cp.m.z) / ((c.t - cp.t) / 1000);
    const e2 = echo.find((x) => x.t >= c.t && x.t <= c.t + 500 && (x.relTo ?? 0) === (c.m.relativeToId ?? 0));
    if (e2) envelope.push({ v, r: Math.hypot(c.m.x - e2.x, c.m.z - e2.z) });
  }
  cp = c;
}
const buckets = [[0, 2], [2, 5], [5, 10], [10, 20], [20, 40], [40, 1e9]];
console.log("\nclaim-speed vs server-echo residual (trust envelope):");
for (const [lo, hi] of buckets) {
  const b = envelope.filter((x) => x.v >= lo && x.v < hi);
  if (!b.length) continue;
  const rs = b.map((x) => x.r).sort((a, c) => a - c);
  console.log(`  v=${String(lo).padStart(2)}..${hi === 1e9 ? "∞" : hi}u/s n=${String(b.length).padStart(4)} residual med=${rs[(rs.length / 2) | 0].toFixed(3)} p95=${rs[Math.min(rs.length - 1, (rs.length * 0.95) | 0)].toFixed(3)}`);
}
const vMax = envelope.length ? Math.max(...envelope.map((x) => x.v)) : 0;
console.log("  max legitimate claim speed observed:", vMax.toFixed(1), "u/s");

// firing + respawn + CSCollision samples ----
for (const name of ["MyFiringMessage", "RequestRespawnMessage", "CSCollision", "EventMessage", "ChatMessage"]) {
  const s = (name === "ChatMessage" ? ev.filter((e) => e.dir === "d") : up).filter((e) => e.name === name);
  if (s.length) console.log(`\n${name} x${s.length}:`, JSON.stringify(s[0].m).slice(0, 220));
}
