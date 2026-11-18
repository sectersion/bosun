// Session-2 sail forensics: markers → interactions → ship motion onset.
const fs = require("fs");
const L = fs.readFileSync("decoded-session-2.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
const t0 = L[0].t;
const T = (t) => "t+" + ((t - t0) / 1000).toFixed(1) + "s";
const up = L.filter((e) => e.dir === "u"), down = L.filter((e) => e.dir === "d");

// 1. markers: the user's own chat
console.log("=== chat markers ===");
for (const e of up.filter((x) => x.name === "MyChatMessage")) console.log("  " + T(e.t) + " SENT: " + e.m.message);

// 2. ship & its motion
const shipIds = [...new Set(up.filter((e) => e.name === "MyTankMessage" && e.m?.relativeToId && e.m.relativeToId !== 2 ** 48 - 1).map((e) => e.m.relativeToId))];
console.log("ships aboard:", shipIds);
const shipPos = [];
for (const e of down) {
  if (e.name !== "WorldMessage" || !e.m.tanks) continue;
  for (const sid of shipIds) { const t = e.m.tanks.find((x) => x.id === sid); if (t && t.x != null) shipPos.push({ t: e.t, sid, x: t.x, y: t.y, z: t.z, rotY: t.rotationY }); }
}
let prev = null;
const motions = [];
for (const p of shipPos) { if (prev && p.sid === prev.sid) { const d = Math.hypot(p.x - prev.x, p.z - prev.z); if (d > 0.35) motions.push({ t: p.t, v: d / ((p.t - prev.t) / 1000) }); } prev = p; }
console.log("ship motion ticks:", motions.length, "first:", motions[0] ? T(motions[0].t) : "NONE", "| sustained motion start:", motions.find((mo, i) => motions[i + 1] && motions[i + 1].t - mo.t < 600) ? T(motions.find((mo, i) => motions[i + 1] && motions[i + 1].t - mo.t < 600).t) : "?");

// 3. interaction episodes (index, deck pos, pull progression)
const claims = up.filter((e) => e.name === "MyTankMessage" && e.m);
let cur = null; const eps = [];
for (const c of claims) {
  const active = c.m.interactingWithIndex >= 0 || c.m.interactableActorId != null;
  if (active) {
    if (!cur || cur.ii !== c.m.interactingWithIndex || c.m.interactableActorId !== cur.ia) { if (cur) eps.push(cur); cur = { ii: c.m.interactingWithIndex, ia: c.m.interactableActorId, start: c.t, end: c.t, maxY: 0, deck: [c.m.x, c.m.y, c.m.z] }; }
    cur.end = c.t; cur.maxY = Math.max(cur.maxY, c.m.interactionVector?.y ?? 0);
  } else if (cur) { eps.push(cur); cur = null; }
}
if (cur) eps.push(cur);
console.log("\n=== interaction episodes ===");
for (const e of eps) console.log(`  ${T(e.start)}..${T(e.end)} ii=${e.ii} ia=${String(e.ia).slice(-6)} deck=(${e.deck.map((v) => (v ?? 0).toFixed(1)).join(",")}) pullY=${e.maxY.toFixed(2)}`);

// 4. animationState timeline (compressed)
const anims = []; let lastA = null;
for (const c of claims) if (c.m.animationState != null && c.m.animationState !== lastA) { anims.push({ t: c.t, a: c.m.animationState }); lastA = c.m.animationState; }
console.log("\n=== anim changes ===");
console.log("  " + anims.map((x) => T(x.t).slice(1) + ":" + x.a).join("  "));

// 5. the money shot: all claim fields that changed in 3s around first sustained motion
const firstMove = motions.find((mo, i) => motions[i + 1] && motions[i + 1].t - mo.t < 600)?.t || motions[0]?.t;
if (firstMove) {
  console.log("\n=== claims around motion onset ===");
  for (const c of claims.filter((c) => Math.abs(c.t - firstMove) < 3500).slice(0, 14))
    console.log("  " + T(c.t), JSON.stringify({ ii: c.m.interactingWithIndex, ia: c.m.interactableActorId != null ? "set" : null, iv: c.m.interactionVector?.y != null ? +c.m.interactionVector.y.toFixed(2) : null, anim: c.m.animationState, a2: c.m.animationState_2, rotY: c.m.rotationY != null ? +c.m.rotationY.toFixed(2) : null, deck: [+(c.m.x ?? 0).toFixed(1), +(c.m.y ?? 0).toFixed(1), +(c.m.z ?? 0).toFixed(1)] }).replace(/"null"/g, "-"));
} else console.log("\nSHIP NEVER MOVED");
