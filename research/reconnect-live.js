// Reconnect proof: connect a fleet bot, start a walk, force a socket drop (simulating a
// lost connection), and confirm it auto-reconnects with a NEW protocolKey, resyncs the
// world, and the in-flight walkTo RESUMES and arrives — no manual re-connect.
import { readFileSync } from "node:fs";
import { listServers, currentVersion } from "../lib/index.js";
import { createBot } from "../lib/bot.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const roster = JSON.parse(readFileSync("fleet-accounts.json", "utf8"));
const servers = await listServers(roster[8].id);
const server = servers.find((s) => s.serverName === "Server 5") ?? servers[4];
const bot = await createBot({ id: roster[8].id, server, clientVersion: await currentVersion() });
bot.spawn(1);
await new Promise((r) => bot.world.once("spawn", r));
await sleep(1500);
const me = bot.world.me();
console.log(`connected v${bot.client.clientVersion} key0=${bot.client.key[0]} at (${me.x.toFixed(1)},${me.z.toFixed(1)})`);

const log = [];
bot.on("reconnecting", (e) => log.push(`reconnecting#${e.attempt}`));
bot.on("reconnect", () => log.push("reconnect"));
bot.on("resuming", () => log.push("resuming"));

// start a walk well beyond the drop window (generous timeout so reconnect ticks-off are fine)
const target = { x: me.x + 18, z: me.z + 6 };
const leg = bot.walkTo(target, { timeoutMs: 90000 }).then((r) => `arrived (${r.pos.x.toFixed(0)},${r.pos.z.toFixed(0)})`)
  .catch((e) => "walk ended: " + e.message);
await sleep(3000);

const keyBefore = [...bot.client.key].join();
console.log(">>> forcing socket drop (simulating lost connection)");
bot.client.ws.close(4001); // app-range code; our reconnect policy is code-agnostic (flags only)

await sleep(8000);
const keyAfter = bot.client.key ? [...bot.client.key].join() : "(null)";
const reconnected = bot.client.connected && keyAfter !== keyBefore;
console.log("events:", log.join(" → ") || "(none)");
console.log(`reconnected=${reconnected} keyRotated=${keyAfter !== keyBefore} hasMe=${!!bot.world.me()}`);

const result = await Promise.race([leg, sleep(70000).then(() => "timeout")]);
const finalMe = bot.world.me();
console.log("walk across reconnect:", result, "| final dist to target:", finalMe ? Math.hypot(finalMe.x - target.x, finalMe.z - target.z).toFixed(1) + "u" : "?");
const ok = log.includes("reconnect") && reconnected && result.startsWith("arrived");
console.log(ok ? "✔ RECONNECT + RESYNC + RESUME WORKS" : "⚠ see above");
bot.close(); process.exit(0);
