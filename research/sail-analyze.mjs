// Sail analysis: reconstruct the helmsman↔ship control model from the live capture.
// Questions: who writes the ship's world position? what input turns/sails it? what does
// board/disembark look like on the wire? usage: node sail-analyze.mjs [decoded.jsonl]
import { readFileSync } from "node:fs";

const lines = readFileSync(process.argv[2] || "decoded-session.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
const WORLD = 2 ** 48 - 1;
const down = lines.filter((e) => e.dir === "d" && e.m);
const up = lines.filter((e) => e.dir === "u" && e.m);

const self = down.find((e) => e.name === "ResetYourState")?.m?.yourTank;
if (!self) { console.log("no yourTank found"); process.exit(1); }
console.log(`self: ${self.username} id=${self.id}`);

// ---- which ship do we ride? ----
const claims = up.filter((e) => e.name === "MyTankMessage");
const aboard = claims.filter((c) => c.m.relativeToId != null && c.m.relativeToId !== WORLD);
console.log(`claims: ${claims.length} total, ${aboard.length} with relativeToId≠WORLD (aboard)`);
const shipIds = [...new Set(aboard.map((c) => c.m.relativeToId))];
console.log(`ship ids we ride:`, shipIds);

// ---- ship world-state timeline from downlink, + our relative claims, interleaved ----
for (const shipId of shipIds) {
  const shipTicks = [];
  for (const e of down) {
    if (e.name !== "WorldMessage" || !e.m.tanks) continue;
    const t = e.m.tanks.find((x) => x.id === shipId);
    if (t && t.x != null) shipTicks.push({ t: e.t, x: t.x, y: t.y, z: t.z, rotY: t.rotationY, anim: t.animationState, tankType: t.tankType, health: t.health, pax: t.passengerIds?.ids?.length });
  }
  if (shipTicks.length < 3) { console.log(`ship ${shipId}: only ${shipTicks.length} ticks (never in full state?)`); continue; }
  console.log(`\n=== ship ${shipId}: ${shipTicks.length} world ticks, tankType=${shipTicks[0].tankType} anim=${[...new Set(shipTicks.map(s=>s.anim).filter(v=>v!=null))].join("/")} pax=${[...new Set(shipTicks.map(s=>s.pax).filter(v=>v!=null))].join("/")||"?"} ===`);
  // speed + turn rate, correlated with our heading input at that moment
  let moved = 0, still = 0, last = null, rows = [];
  for (const s of shipTicks) {
    if (last) {
      const dt = (s.t - last.t) / 1000;
      if (dt > 1) { last = s; continue; }
      const v = Math.hypot(s.x - last.x, s.z - last.z) / dt;
      let turn = 0;
      if (s.rotY != null && last.rotY != null) { turn = ((s.rotY - last.rotY + Math.PI * 3) % (Math.PI * 2)) - Math.PI; turn /= dt; }
      (v > 0.3 ? rows : [] ).push({ t: s.t, v, turn, shipRot: s.rotY, meRot: nearestClaim(s.t)?.m?.rotationY, myX: nearestClaim(s.t)?.m?.x, myZ: nearestClaim(s.t)?.m?.z });
      if (v > 0.3) moved++; else still++;
    }
    last = s;
  }
  const near = (arr, f, g) => { const v = arr.map(f).sort((a, b) => a - b); return v.length ? `${v[0].toFixed(g)}..${v.at(-1).toFixed(g)} med ${v[(v / 2) | 0] ?? v.at(-1)}` : "-"; };
  const vs = rows.map((r) => r.v), ts = rows.map((r) => Math.abs(r.turn)).filter((x) => x > 0.01);
  if (rows.length) {
    const sv = [...vs].sort((a, b) => a - b), stv = [...ts].sort((a, b) => a - b);
    console.log(`moving ticks: ${rows.length} still: ${still}`);
    console.log(`ship speed u/s: p10 ${sv[(sv.length*.1)|0]?.toFixed(2)} med ${sv[(sv.length*.5)|0]?.toFixed(2)} p90 ${sv[(sv.length*.9)|0]?.toFixed(2)} max ${sv.at(-1)?.toFixed(2)}`);
    console.log(`turn rate rad/s: med ${stv[(stv.length*.5)|0]?.toFixed(3)} max ${stv.at(-1)?.toFixed(3)} (n=${ts.length})`);
    // does ship rotation follow our claim rotationY (camera/rudder)?
    const paired = rows.filter((r) => r.meRot != null && r.shipRot != null);
    if (paired.length > 5) {
      let dHead = 0, n = 0;
      for (let i = 1; i < paired.length; i++) {
        const dShip = ((paired[i].shipRot - paired[i - 1].shipRot + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
        const dMe = ((paired[i].meRot - paired[i - 1].meRot + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
        if (Math.abs(dShip) > 0.005) { dHead += Math.sign(dShip) === Math.sign(dMe) ? 1 : -1; n++; }
      }
      console.log(`turn follows our rotationY sign: ${dHead}/${n} (${n ? (100 * dHead / n).toFixed(0) : 0}% agreement)`);
    }
    console.log("sample moving rows:", JSON.stringify(rows.slice(0, 3).map(r => ({v:+r.v.toFixed(2), turn:+r.turn.toFixed(3), shipRot:+r.shipRot?.toFixed?.(2), meRot:+r.meRot?.toFixed?.(2)}))));
  } else console.log("ship never moved?!");
}

// ---- heading convention: velocity angle vs ship rotationY, turn-rate vs our yaw lead ----
for (const shipId of shipIds) {
  const ticks = [];
  for (const e of down) {
    if (e.name !== "WorldMessage") continue;
    const t = e.m.tanks?.find((x) => x.id === shipId);
    if (t && t.x != null) ticks.push({ t: e.t, x: t.x, z: t.z, rotY: t.rotationY ?? null });
  }
  for (let i = 1; i < ticks.length; i++) if (ticks[i].rotY == null && ticks[i - 1].rotY != null) ticks[i].rotY = ticks[i - 1].rotY; // carry-forward for diff
  const offs = [];
  for (let i = 1; i < ticks.length; i++) {
    const a = ticks[i - 1], b = ticks[i];
    const dt = (b.t - a.t) / 1000; if (dt > 0.5 || dt <= 0) continue;
    const v = Math.hypot(b.x - a.x, b.z - a.z) / dt;
    if (v < 1 || b.rotY == null) continue;
    let d = Math.atan2(b.x - a.x, b.z - a.z) - b.rotY;
    d = ((d + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    offs.push((d * 180) / Math.PI);
  }
  offs.sort((x, y) => x - y);
  console.log(`\nship ${shipId}: velocity-vs-bow offset n=${offs.length} med=${offs[(offs.length / 2) | 0]?.toFixed(1)}° p25=${offs[(offs.length * .25) | 0]?.toFixed(1)}° p75=${offs[(offs.length * .75) | 0]?.toFixed(1)}°`);
  // our yaw → ship turn (next 1s)
  const shipTicks2 = down.filter((e) => e.name === "WorldMessage" && e.m.tanks?.some((t) => t.id === shipId && t.rotationY != null)).map((e) => ({ t: e.t, rotY: e.m.tanks.find((t) => t.id === shipId).rotationY }));
  let agree = 0, contra = 0;
  for (let i = 1; i < shipTicks2.length; i++) {
    const dt = (shipTicks2[i].t - shipTicks2[i - 1].t) / 1000; if (dt > 1) continue;
    let dShip = ((shipTicks2[i].rotY - shipTicks2[i - 1].rotY + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    if (Math.abs(dShip) < 0.01) continue;
    const my = aboard.filter((c) => c.m.relativeToId === shipId && c.m.rotationY != null).map((c) => ({ t: c.t, rotationY: c.m.rotationY }));
    const c0 = my.filter((c) => c.t <= shipTicks2[i - 1].t).pop(), c1 = my.filter((c) => c.t > shipTicks2[i - 1].t && c.t <= shipTicks2[i].t).shift();
    if (c1 && c0 && c1 !== c0) { const dMe = c1.rotationY - c0.rotationY; if (Math.abs(dMe) < 0.005) continue; (Math.sign(dMe) === Math.sign(dShip) ? agree++ : contra++); }
  }
  console.log(`ship ${shipId}: our yaw-delta predicts ship turn: agree=${agree} contra=${contra}`);
}

// ---- boarding/disembark transitions ----
let prevRel = null;
for (const c of claims) {
  const rel = c.m.relativeToId ?? WORLD;
  if (prevRel !== null && rel !== prevRel) {
    console.log(`\nFRAME TRANSITION ${prevRel === WORLD ? "WORLD" : "ship " + prevRel} -> ${rel === WORLD ? "WORLD" : "ship " + rel} @ claim:`, JSON.stringify(c.m).slice(0, 220));
    const around = down.filter((e) => Math.abs(e.t - c.t) < 1500 && ["EventMessage", "ResetYourState"].includes(e.name));
    around.forEach((e) => console.log("   near:", e.name, JSON.stringify(e.m).slice(0, 140)));
  }
  prevRel = rel;
}
// interesting other uplinks
for (const name of ["SelectShipMessage", "ShipSelectedMessage", "RequestRespawnMessage", "CSCollision"]) {
  const xs = up.filter((e) => e.name === name);
  if (xs.length) console.log(`\n${name} x${xs.length}:`, JSON.stringify(xs[0].m).slice(0, 180));
}
function nearestClaim(t) {
  let best = null, bd = 1e9;
  for (const c of aboard) { const d = Math.abs(c.t - t); if (d < bd) { bd = d; best = c; } }
  return bd < 400 ? best : null;
}
