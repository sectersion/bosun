// Decode a capture session: handshake -> protocolKey -> all downlink LZ4+protobuf,
// all uplink XOR+protobuf, then a movement-focused timeline + claimed-vs-echoed report.
// usage: node analyze.mjs [capture.jsonl]
import { readFileSync } from "node:fs";
import { decompressFrame } from "../lib/lz4.js";
import { TYPE, BY_ID, decode } from "../lib/proto.js";

const file = process.argv[2] || "capture-1.jsonl";
const lines = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const b64ToU8 = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
const NAME = Object.fromEntries(Object.entries(TYPE).map(([n, id]) => [id, n]));

const open = lines.filter((l) => l.dir === "open" && /wss:\/\/api/.test(l.url)).pop();
if (!open) { console.log("no game socket found"); process.exit(1); }
console.log(`socket: ${open.url}  from ${new Date(open.t).toISOString()}`);
const frames = lines.filter((l) => (l.dir === "d" || l.dir === "u") && l.b && l.t >= open.t);

let key = null;
const t0 = open.t;
const events = [];           // decoded, tagged
let self = null;             // {id, username}
for (const f of frames) {
  const raw = b64ToU8(f.b);
  if (f.dir === "d") {
    let o; try { o = decompressFrame(raw); } catch { continue; }
    if (!key && o.length === 264 && o.subarray(0, 8).join() === [13, 14, 10, 13, 11, 14, 14, 15].join()) {
      key = o.subarray(8); events.push({ t: f.t - t0, dir: "d", name: "HANDSHAKE" }); continue;
    }
    if (!key) continue;
    const id = o[0];
    let msg; try { msg = decode(id, o.subarray(1)); } catch { msg = undefined; }
    if (id === TYPE.ResetYourState && msg?.yourTank && !self) self = { id: msg.yourTank.id, username: msg.yourTank.username };
    events.push({ t: f.t - t0, dir: "d", id, name: NAME[id] || `#${id}`, msg });
  } else {
    if (!key) continue;
    const o = raw.map((x, i) => x ^ key[i % key.length]);
    const id = o[0];
    let msg; try { msg = decode(id, new Uint8Array(o.slice(1))); } catch { msg = undefined; }
    events.push({ t: f.t - t0, dir: "u", id, name: NAME[id] || `#${id}`, msg });
  }
}
if (!key) { console.log("handshake never decoded"); process.exit(1); }
console.log(`self: ${self?.username} id=${self?.id}   decoded ${events.length} frames over ${(frames.at(-1).t - t0) / 1000}s\n`);

const up = events.filter((e) => e.dir === "u");
const down = events.filter((e) => e.dir === "d");
const byName = (arr) => arr.reduce((m, e) => ((m[e.name] = (m[e.name] || 0) + 1), m), {});
console.log("UPLINK mix:", JSON.stringify(byName(up)));
console.log("DOWNLINK mix:", JSON.stringify(byName(down)));

// --- uplink MyTankMessage anatomy: which fields does a legit client actually send? ---
const tks = up.filter((e) => e.name === "MyTankMessage" && e.msg);
const fieldMix = {};
for (const e of tks) { const k = Object.keys(e.msg).sort().join(","); fieldMix[k] = (fieldMix[k] || 0) + 1; }
console.log("\nMyTankMessage field-sets (uplink, diff-shape):");
for (const [k, n] of Object.entries(fieldMix).sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${String(n).padStart(4)}x  ${k}`);

// --- motion: claimed positions over time + speed, segmented by gaps/animState ---
console.log("\nClaimed motion (MyTankMessage with coords):");
let prev = null;
for (const e of tks) {
  const m = e.msg; if (m.x == null && m.z == null) continue;
  const line = [`+${String(Math.round(e.t)).padStart(5)}ms`, `x=${(m.x ?? 0).toFixed(2)}`, `z=${(m.z ?? 0).toFixed(2)}`,
    ...(m.rotationY != null ? [`rotY=${m.rotationY.toFixed(3)}`] : []),
    ...(m.animationState != null ? [`anim=${m.animationState}`] : []),
    ...(m.relativeToId != null ? [`relTo=${m.relativeToId}`] : []),
    `iIdx=${m.interpolationIndex}`];
  if (prev) { const dt = (e.t - prev.t) / 1000; const d = Math.hypot((m.x ?? 0) - prev.x, (m.z ?? 0) - prev.z);
    line.push(`dt=${dt.toFixed(2)}s`, `step=${d.toFixed(2)}`, `v=${(d / dt).toFixed(1)}u/s`); }
  console.log("  " + line.join(" "));
  prev = { t: e.t, x: m.x ?? prev?.x ?? 0, z: m.z ?? prev?.z ?? 0 };
}

// --- does the server echo our claims? compare self-position in downlink WorldMessage tanks ---
const echoes = [];
for (const e of down) {
  if (e.name !== "WorldMessage" || !e.msg?.tanks) continue;
  const tk = e.msg.tanks.find((t) => t.id === self.id);
  if (tk) echoes.push({ t: e.t, x: tk.x, z: tk.z, anim: tk.animationState, rotY: tk.rotationY, interp: tk.interpolationIndex, full: e.msg.isFullState });
}
console.log(`\nServer echoes of self in WorldMessage: ${echoes.length} (claimed with coords: ${tks.filter(e => e.msg?.x != null).length})`);
for (const e of echoes.slice(0, 15)) console.log(`  +${String(Math.round(e.t)).padStart(5)}ms ${e.full ? "FULL " : "     "}x=${e.x?.toFixed?.(2)} z=${e.z?.toFixed?.(2)} anim=${e.anim} interp=${e.interp}`);
