// Live sailing proof: give a fleet account a sloop, respawn aboard, sail to a waypoint,
// render the trail. Run: node sail-live.js [serverName]
import { readFileSync } from "node:fs";
import { listServers } from "../lib/index.js";
import { createBot } from "../lib/bot.js";
import { attachInspector } from "../lib/inspect.js";
import { toSVG } from "../lib/render.js";
import { WORLD } from "../lib/world.js";

const serverName = process.argv[2] || "Server 5";
const roster = JSON.parse(readFileSync("fleet-accounts.json", "utf8"));
const servers = await listServers(roster[1].id);
const server = servers.find((s) => s.serverName === serverName) ?? servers[4];
const bot = await createBot({ id: roster[1].id, server });
const detach = attachInspector(bot, { label: "sailor" });

let verdict = null;
bot.on("event", (m) => { if (/ship|sloop|level|requir|denied|unlock/i.test(`${m.primary} ${m.secondary ?? ""}`)) verdict = m; });

bot.client.send("SelectShipMessage", { shipType: 1 });
await new Promise((r) => setTimeout(r, 800));
bot.spawn(2); // your ship
const spawned = await Promise.race([
  new Promise((r) => bot.world.once("spawn", () => r("spawn"))),
  new Promise((r) => setTimeout(() => r("timeout"), 6000)),
]);
await new Promise((r) => setTimeout(r, 2000));
const me = bot.world.me();
const aboard = me && me.relativeToId != null && me.relativeToId !== WORLD;
console.log(`\nspawned=${spawned} aboard=${aboard} verdict=${JSON.stringify(verdict)}`);
if (!aboard) {
  console.log("NOT ABOARD — ship ownership gate on registered-but-fresh accounts. Events seen above.");
  detach(); bot.close(); process.exit(3);
}

const ship = bot.world.byId(me.relativeToId);
const start = { x: ship.x, z: ship.z };
const target = { x: ship.x, z: ship.z - 150 }; // 150u due "north"
console.log(`aboard ship id=${ship.id} at (${start.x.toFixed(0)},${start.z.toFixed(0)}), sailing to (${target.x.toFixed(0)},${target.z.toFixed(0)})`);
const trail = [{ x: start.x, z: start.z }];
bot.on("sailing", (s) => { if (!trail.length || Math.hypot(s.ship.x - trail.at(-1).x, s.ship.z - trail.at(-1).z) > 2) trail.push(s.ship); });
try {
  const done = await bot.sailTo(target);
  console.log(`\n✔ ARRIVED after ${bot.helmsman.stats.claims} helm claims — ship at (${done.pos.x.toFixed(0)},${done.pos.z.toFixed(0)})`);
  console.log(`  travelled ${Math.hypot(done.pos.x - start.x, done.pos.z - start.z).toFixed(0)}u of ${Math.hypot(target.x - start.x, target.z - start.z).toFixed(0)}u ordered, trail pts=${trail.length}`);
} catch (e) {
  console.log(`\n✖ ${e.message} | claims=${bot.helmsman.stats.claims} trail pts=${trail.length}`);
}
const { writeFileSync } = await import("node:fs");
writeFileSync("sail-trail.svg", toSVG(bot.world, { range: 340, center: bot.world.byId(me.relativeToId) ?? undefined, trail }));
console.log("sail-trail.svg written");
bot.chat("sailing engine live (bosun)");
await new Promise((r) => setTimeout(r, 1500));
detach(); bot.close(); process.exit(0);
