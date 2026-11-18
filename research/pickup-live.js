// Pickup success attempt: walk to a nearby ItemActor and PickUpItemMessage it.
// Prior coverage found distance validation ("too far away" at 13.5m) but couldn't get close
// (movement was unsolved). Now bot.walkTo works — this is the first time the success path is
// reachable. Captures EVERY reply so we learn the accept shape even if it's an error.
import { readFileSync } from "node:fs";
import { listServers } from "../lib/index.js";
import { createBot } from "../lib/bot.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const roster = JSON.parse(readFileSync("fleet-accounts.json", "utf8"));
const servers = await listServers(roster[6].id);
const server = servers.find((s) => s.serverName === "Server 5") ?? servers[4];
const A = await createBot({ id: roster[6].id, server });
A.spawn(1);
await new Promise((r) => A.world.once("spawn", r));
await sleep(3000);

// log every non-tick reply for the whole session
const replies = [];
A.client.on("message", ({ name, msg }) => {
  if (["WorldMessage", "ScoresMessage", "CannonBallMessage", "RemoveCannonBall", "FriendGids", "ItemCountMessage", "MyCrewResponse", "EquippedItems"].includes(name)) { replies.push({ name, msg }); return; }
  replies.push({ name, msg });
});

const me0 = A.world.me();
console.log(`me at (${me0.x.toFixed(1)},${me0.y.toFixed(1)},${me0.z.toFixed(1)})`);
// rank ItemActors by distance, try the 3 nearest reachable
const items = A.world.items().filter((it) => it.x != null);
console.log(`ItemActors in view: ${items.length}`);
items.sort((a, b) => Math.hypot(a.x - me0.x, a.z - me0.z) - Math.hypot(b.x - me0.x, b.z - me0.z));

for (const it of items.slice(0, 4)) {
  const d = Math.hypot(it.x - me0.x, it.z - me0.z);
  console.log(`\n→ item …${String(it.id).slice(-5)} type=${it.itemType} at ${d.toFixed(1)}u (y=${it.y?.toFixed(1)})`);
  if (d > 1.5) { try { await A.walkTo({ x: it.x, z: it.z }, { timeoutMs: 20000, arriveRadius: 1 }); } catch (e) { console.log("   walk:", e.message); continue; } }
  replies.length = 0;
  const me = A.world.me();
  const dNow = Math.hypot(it.x - me.x, it.z - me.z);
  console.log(`   walked to ${dNow.toFixed(1)}u of item, sending PickUpItemMessage ×3`);
  for (let i = 0; i < 3; i++) { A.client.send("PickUpItemMessage", { actorId: it.id }); await sleep(200); }
  await sleep(1500);
  const interesting = replies.filter((r) => !["WorldMessage", "ScoresMessage", "CannonBallMessage", "RemoveCannonBall", "FriendGids"].includes(r.name));
  console.log("   replies:", interesting.length ? JSON.stringify(interesting.map((r) => ({ n: r.name, m: r.msg }))).slice(0, 300) : "(none beyond ticks)");
  const carried = A.world.me()?.carriedItemId;
  const bagChanged = replies.some((r) => r.name === "ItemCountMessage" || r.name === "EquippedItems");
  const vanished = replies.some((r) => r.name === "WorldMessage" && r.msg.actorsToRemove?.includes(it.id)) || !A.world.byId(it.id);
  console.log(`   carriedItemId=${carried} bagEcho=${bagChanged} itemGone=${vanished} ${carried != null || bagChanged || vanished ? "  ✔ PICKUP WORKED" : ""}`);
  if (carried != null || bagChanged || vanished) break;
}

// if we picked something up, try dropping it back (DropItemMessage{foo, x, y, z})
const finalCarry = A.world.me()?.carriedItemId;
if (finalCarry != null) {
  const me = A.world.me();
  console.log(`\ncarrying …${String(finalCarry).slice(-5)}, testing DropItemMessage`);
  A.client.send("DropItemMessage", { foo: true, x: me.x, y: me.y, z: me.z + 1 });
  await sleep(1200);
  console.log("   after drop, carriedItemId=", A.world.me()?.carriedItemId);
}

A.close(); process.exit(0);
