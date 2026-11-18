// Live player-interaction battery v2 on 2 bots: weapon switching (echo check),
// melee with TARGET-LOCAL coords (per bundle forensics), pickup via the dedicated
// PickUpItemMessage{actorId}. Server echoes are the source of truth.
import { readFileSync } from "node:fs";
import { listServers } from "../lib/index.js";
import { createBot } from "../lib/bot.js";
import { WORLD } from "../lib/world.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const roster = JSON.parse(readFileSync("fleet-accounts.json", "utf8"));
const servers = await listServers(roster[4].id);
const server = servers.find((s) => s.serverName === "Server 5") ?? servers[4];
const A = await createBot({ id: roster[4].id, server });
const B = await createBot({ id: roster[5].id, server });
A.spawn(1); B.spawn(1);
await Promise.all([new Promise((r) => A.world.once("spawn", r)), new Promise((r) => B.world.once("spawn", r))]);
await sleep(2500);

const dmgSeen = [];
for (const [tag, bot] of [["A", A], ["B", B]]) bot.on("damage", (m) => dmgSeen.push({ ...m, to: tag }));
const hitsOnB = [];
B.on("HitMeFromMessage", (m) => hitsOnB.push(m));
B.client.on("message", ({ name, msg }) => { if (name === "HitMeFromMessage") hitsOnB.push(msg); });

// -- 1. weapon switch
const a0 = A.world.me();
for (let i = 0; i < 10; i++) {
  A.client.send("MyTankMessage", { id: a0.id, x: a0.x, y: a0.y, z: a0.z, rotationY: 0, heldWeapon: 4, animationState: 11, relativeToId: WORLD, relativeToVehicleId: WORLD, vehiclePositionIndex: 0, interactingWithIndex: -1, interactionVector: {}, interpolationIndex: (i % 5) + 1 });
  await sleep(100);
}
const echoHW = A.world.me()?.heldWeapon;
console.log(`1. WEAPON SWITCH: claimed 4 → echo ${echoHW} ${echoHW === 4 ? "✔" : "✖"}`);

// -- 2. melee, target-local geometry
const pb = B.world.me();
let aPos = A.world.me();
if (Math.hypot(aPos.x - pb.x, aPos.z - pb.z) > 3) { try { await A.walkTo({ x: pb.x + 1.2, z: pb.z }, { timeoutMs: 30000 }); } catch {} aPos = A.world.me(); }
const bNow = B.world.me();
const hp0 = bNow.health;
const yaw = bNow.rotationY ?? 0, c = Math.cos(-yaw), sn = Math.sin(-yaw);
const lrot = (x, z) => [x * c - z * sn, x * sn + z * c];
const dl = Math.hypot(aPos.x - bNow.x, aPos.z - bNow.z) || 1;
const dirLoc = lrot((bNow.x - aPos.x) / dl, (bNow.z - aPos.z) / dl); // attacker→target unit, in target-local frame
const aClaim = { id: aPos.id, x: aPos.x, y: aPos.y, z: aPos.z, relativeToId: WORLD, relativeToVehicleId: WORLD, vehiclePositionIndex: 0, interactingWithIndex: -1, interactionVector: {}, animationState: 11, heldWeapon: 4 };
for (let i = 0; i < 30; i++) {
  A.client.send("MyTankMessage", { ...aClaim, rotationY: Math.atan2(bNow.x - aPos.x, bNow.z - aPos.z), interpolationIndex: (i % 5) + 1 });
  // hit point = target center (body), direction = attack ray — both target-local
  A.client.send("MyMeleeAttack", { tankIdHit: bNow.id, relativeX: 0, relativeY: 0.8, relativeZ: 0, weaponType: 4, relativeDirectionX: dirLoc[0], relativeDirectionY: 0, relativeDirectionZ: dirLoc[1] });
  await sleep(110);
}
await sleep(1500);
const hp1 = B.world.me()?.health;
const onB = dmgSeen.filter((d) => d.tankId === bNow.id);
console.log(`2. MELEE: 30 target-local swings | B hp ${hp0} → ${hp1} | TankDamage on B: ${onB.length} | HitMeFrom B received: ${hitsOnB.length} ${onB.length || hitsOnB.length ? "✔ HITS REGISTERED" : "— no hp change"} | other damage events: ${dmgSeen.length - onB.length}`);
if (onB[0]) console.log("   sample:", JSON.stringify(onB[0]).slice(0, 160));

// -- 3. pickup: dedicated message, real ItemActors only (tankType 9)
const items = A.world.items();
console.log(`3. PICKUP: ${items.length} ItemActor (tankType 9) in view`);
if (items.length) {
  const me = A.world.me();
  const it = items.sort((p, q) => Math.hypot(p.x - me.x, p.z - me.z) - Math.hypot(q.x - me.x, q.z - me.z))[0];
  const d = Math.hypot(it.x - me.x, it.z - me.z);
  console.log(`   nearest …${String(it.id).slice(-6)} type=${it.itemType} at ${d.toFixed(1)}u`);
  if (d > 2.5) { try { await A.walkTo({ x: it.x, z: it.z }, { timeoutMs: 25000 }); } catch {} }
  let bag = null;
  A.on("itemCount", (m) => (bag = bag ?? { itemCount: m }));
  A.on("equippedItems", (m) => (bag = bag ?? { equipped: m.bagItems?.length ?? "changed" }));
  A.on("actorGone", (a) => { if (a.id === it.id) bag = bag ?? { itemVanished: true }; });
  for (let i = 0; i < 20 && !bag; i++) { A.client.send("PickUpItemMessage", { actorId: it.id }); await sleep(150); }
  console.log(`   pickup ${bag ? "✔ " + JSON.stringify(bag).slice(0, 120) : "— no echo (not carryable / needs line-of-sight or hands free)"}`);
}

A.close(); B.close(); process.exit(0);
