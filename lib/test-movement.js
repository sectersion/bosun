// Offline tests for the movement stepper. run: node test-movement.js
import { steer } from "./movement.js";
let pass = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } pass++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

{
  const r = steer({ x: 0, y: 1, z: 0 }, { x: 10, y: 1, z: 0 }, 1);
  ok(near(r.pos.x, 1) && !r.arrived, "steps toward target at maxStep");
  ok(near(r.pos.y, 1), "y preserved");
}
{
  const r = steer({ x: 0, y: 1, z: 0 }, { x: 0.2, y: 1, z: 0 }, 1);
  ok(r.arrived, "arrives inside step cap");
  ok(near(r.pos.x, 0.2), "snaps to target on arrival");
}
{
  const r = steer({ x: 0, z: 0 }, { x: 3, y: 1, z: 4 }, 2);
  ok(near(Math.hypot(r.pos.x, r.pos.z), 2, 0.01), "diagonal step respects cap");
  ok(near(r.heading, Math.atan2(3, 4), 0.01), "heading = atan2(dx,dz)");
}
{
  let p = { x: 5, y: 2, z: 5 }, n = 0;
  while (n++ < 200) { const r = steer(p, { x: 50, y: 2, z: 5 }, 0.36); p = r.pos; if (r.arrived) break; }
  ok(n <= 130 && Math.hypot(p.x - 50, p.z - 5) < 0.3, `converges 45u at 0.36/step in ${n} steps`);
}
console.log(`movement: ALL ${pass} ASSERTIONS PASS`);
