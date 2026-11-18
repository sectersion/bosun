const fs = require("fs");
const lines = fs.readFileSync("decoded-session.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
const shipId = 2987989386284;
const claims = lines.filter((e) => e.dir === "u" && e.name === "MyTankMessage" && e.m);
const shipMoves = [];
let sp = null;
for (const e of lines) {
  if (e.dir !== "d" || e.name !== "WorldMessage" || !e.m.tanks) continue;
  const t = e.m.tanks.find((x) => x.id === shipId);
  if (t && t.x != null) {
    if (sp && Math.hypot(t.x - sp.x, t.z - sp.z) > 0.4) shipMoves.push(e.t);
    sp = t;
  }
}
console.log("ship2987 motion-ticks:", shipMoves.length, "first:", shipMoves[0] ? "t+" + ((shipMoves[0] - lines[0].t) / 1000).toFixed(0) + "s" : "NONE");
let cur = null;
const eps = [];
for (const c of claims) {
  const iv = c.m.interactionVector || {};
  const active = c.m.interactingWithIndex >= 0 || c.m.interactableActorId != null;
  if (active) {
    if (!cur || cur.ii !== c.m.interactingWithIndex) {
      if (cur) eps.push(cur);
      cur = { ii: c.m.interactingWithIndex, start: c.t, end: c.t, maxY: 0 };
    }
    cur.end = c.t;
    if (iv.y > cur.maxY) cur.maxY = iv.y;
  } else if (cur) { eps.push(cur); cur = null; }
}
if (cur) eps.push(cur);
console.log("interaction episodes:", eps.length);
for (const ep of eps.slice(0, 12)) {
  const moved = shipMoves.some((m) => m > ep.start && m < ep.end + 5000);
  console.log(`  ii=${ep.ii} dur=${((ep.end - ep.start) / 1000).toFixed(1)}s pullY=${ep.maxY.toFixed(2)}${moved ? "  <— SHIP MOVED after" : ""}`);
}
