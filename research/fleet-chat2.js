// Fleet chat PoC v2: random REGISTERED accounts (random email+password, nothing ever
// sent — domains use the reserved .invalid TLD), real spawn into the world, then greet.
// Roster (id/email/password) is written to fleet-accounts.json (gitignored) for recovery.
// usage: node fleet-chat2.js [N] [serverName]
import { register, registerAccount, setName, listServers, GameClient } from "../lib/index.js";
import { writeFileSync } from "node:fs";

const N = Number(process.argv[2] || 50);
const wantServer = process.argv[3] || "Server 4";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const stamp = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6);
const rnd = (n) => Array.from({ length: n }, () => "abcdefghjkmnpqrstuvwxyz23456789"[(Math.random() * 31) | 0]).join("");
const WORDS = ["brine", "anchor", "sloop", "galleon", "harbor", "coral", "fathom", "keel", "tide", "squall", "mizzen", "bowline"];
const rndEmail = () => `${rnd(10)}@${WORDS[(Math.random() * WORDS.length) | 0]}${(Math.random() * 90 + 10) | 0}.invalid`;

const servers = await listServers((await register()).id);
// 429 backoff: /user/register/ is per-IP rate-limited (discovered 2026-11-18)
async function polite(fn, tag) {
  for (let a = 0; a < 6; a++) {
    try { return await fn(); }
    catch (e) {
      if (!/429/.test(e.message)) throw e;
      const wait = 2000 * (a + 1);
      console.log(`[${stamp()}s] 429 on ${tag}, backing off ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  throw new Error(tag + ": rate limit persisted");
}
const server = servers.find((s) => s.serverName === wantServer) ?? servers.slice().sort((a, b) => a.playerCount - b.playerCount)[0];
console.log(`[${stamp()}s] ${server.serverName} ${server.playerCount}/${server.maxPlayerCount}, summoning ${N} REGISTERED bots`);

const roster = [];
for (let i = 0; i < N; i++) {
  const me = await polite(() => register(), "register");
  const email = rndEmail(), pw = rnd(12);
  await polite(() => registerAccount(me.id, email, pw), "registerAccount");
  const named = await polite(() => setName(me.id, `bosun-${String(i + 1).padStart(2, "0")}`), "setName");
  roster.push({ i, id: me.id, email, pw, username: named.username });
  if ((i + 1) % 25 === 0) console.log(`[${stamp()}s] registered ${i + 1}/${N}`);
  await sleep(250); // steady pace under the limiter
}
writeFileSync("fleet-accounts.json", JSON.stringify(roster, null, 1));

// connect + SPAWN
const fleet = [];
for (const a of roster) {
  const c = new GameClient({ id: a.id, server });
  c.on("error", () => {});
  const b = { ...a, c, spawned: false, echoes: 0, rejects: 0 };
  fleet.push(b);
  try { await c.connect(); } catch (e) { console.log(`[${stamp()}s] ${a.username} connect failed: ${e.message}`); continue; }
  c.on("EventMessage", (m) => { if (m.primary === "You have been respawned") b.spawned = true; });
  const crew = new Promise((r) => c.once("MyCrewResponse", r));
  c.once("MyCrewResponse", () => c.send("RequestRespawnMessage", { location: 1 }));
  await crew;
  await sleep(90);
}
console.log(`[${stamp()}s] connected; waiting for world spawn...`);
await sleep(3000);
console.log(`[${stamp()}s] spawned in world: ${fleet.filter((b) => b.spawned).length}/${fleet.length}`);

// collect echoes/rejects across ALL sockets (any broadcast proves delivery)
for (const b of fleet) {
  b.c.on("ChatMessage", (m) => { if (m.username === b.username) b.echoes++; });
  b.c.on("EventMessage", (m) => { if (/chat|level|regist/i.test(`${m.primary}${m.secondary}`)) b.rejects++, console.log(`[${stamp()}s] ${b.username} gate says:`, JSON.stringify(m).slice(0, 160)); });
}
console.log(`[${stamp()}s] greeting...`);
for (const b of fleet) {
  try { b.c.send("MyChatMessage", { isGroup: false, message: `hi from Claude Code — ${b.username}` }); } catch {}
  await sleep(220);
}
await sleep(5000);
const echoes = fleet.reduce((s, b) => s + b.echoes, 0), rej = fleet.reduce((s, b) => s + b.rejects, 0);
console.log(`[${stamp()}s] sent=${fleet.length} echoes=${echoes} gate-rejections=${rej} spawned=${fleet.filter((b) => b.spawned).length}`);
for (const b of fleet) { try { b.c.close(); } catch {} }
process.exit(0);
