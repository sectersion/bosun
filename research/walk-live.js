// Live proof: reconnect a fleet account, spawn on port, walk toward the island center,
// with the inspector rendering every phase. Run: node walk-live.js [serverName]
import { readFileSync } from "node:fs";
import { listServers } from "../lib/index.js";
import { createBot } from "../lib/bot.js";
import { attachInspector } from "../lib/inspect.js";

const serverName = process.argv[2] || "Server 5";
const roster = JSON.parse(readFileSync("fleet-accounts.json", "utf8"));
const servers = await listServers(roster[0].id);
const server = servers.find((s) => s.serverName === serverName);
const bot = await createBot({ id: roster[0].id, server });
const detach = attachInspector(bot, { trace: "walk-live-trace.jsonl", label: "walker" });

bot.spawn(1);
await new Promise((r) => bot.world.once("spawn", r));
await new Promise((r) => setTimeout(r, 2500));   // let world fill in
const me = bot.world.me();
const isl = bot.world.islands()[0];
// target: 15 units from spawn toward the island's center (or due +x if no island yet)
const dir = isl ? { x: isl.x - me.x, z: isl.z - me.z } : { x: 1, z: 0 };
const len = Math.hypot(dir.x, dir.z) || 1;
const target = { x: me.x + (dir.x / len) * 15, z: me.z + (dir.z / len) * 15 };
console.log(`\nwalking ${Math.round(15)}u: (${me.x.toFixed(1)},${me.z.toFixed(1)}) -> (${target.x.toFixed(1)},${target.z.toFixed(1)})`);

const start = { x: me.x, z: me.z };
try {
  const done = await bot.walkTo(target, { timeoutMs: 25000 });
  const echo = bot.world.me() ?? done.pos;
  const claimed = Math.hypot(done.pos.x - start.x, done.pos.z - start.z);
  const observed = Math.hypot(echo.x - start.x, echo.z - start.z);
  console.log(`\n✔ arrived | claimed travel ${claimed.toFixed(1)}u | SERVER-SEEN travel ${observed.toFixed(1)}u | stats ${JSON.stringify(bot.movement.stats)}`);
  bot.chat("walk engine live (bosun)");
} catch (e) {
  const echo = bot.world.me();
  console.log(`\n✖ ${e.message} | final (${echo?.x.toFixed?.(1)},${echo?.z.toFixed?.(1)}) start (${start.x.toFixed(1)},${start.z.toFixed(1)}) | stats ${JSON.stringify(bot.movement.stats)}`);
}
await new Promise((r) => setTimeout(r, 1500));
detach(); bot.close(); process.exit(0);
