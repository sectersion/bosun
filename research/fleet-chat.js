// Fleet chat PoC: summon N bots, preflight ONE chat message (guest chat is suspected
// gated), then if allowed have every bot greet. usage: node fleet-chat.js [N] [server]
import { register, setName, listServers, GameClient } from "../lib/index.js";

const N = Number(process.argv[2] || 50);
const wantServer = process.argv[3] || "Server 4";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const stamp = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6);

const servers = await listServers((await register()).id);
const server = servers.find((s) => s.serverName === wantServer) ?? servers.slice().sort((a, b) => a.playerCount - b.playerCount)[0];
console.log(`[${stamp()}s] ${server.serverName} ${server.playerCount}/${server.maxPlayerCount}, summoning ${N}`);

const fleet = [];
for (let i = 0; i < N; i++) {
  const me = await register();
  await setName(me.id, `bosun-${String(i + 1).padStart(2, "0")}`);
  const c = new GameClient({ id: me.id, server });
  c.on("error", () => {});
  fleet.push({ i, me, c });
}
for (const b of fleet) { try { await b.c.connect(); } catch (e) { console.log(`[${stamp()}s] #${b.i} connect failed: ${e.message}`); } await sleep(100); }
console.log(`[${stamp()}s] connected, preflight chat probe from bosun-01...`);

// preflight: one message, watch for echo (allowed) vs EventMessage (gated)
const probe = fleet[0];
probe.c.send("MyChatMessage", { isGroup: false, message: "hi from Claude Code (test)" });
const result = await Promise.race([
  new Promise((res) => probe.c.on("ChatMessage", (m) => { if (m.username === probe.me.username) res({ ok: true, echo: m }); })),
  new Promise((res) => probe.c.on("EventMessage", (m) => res({ ok: false, event: m }))),
  new Promise((res) => setTimeout(() => res({ ok: "timeout" }), 5000)),
]).catch(() => ({ ok: "error" }));
console.log(`[${stamp()}s] probe:`, JSON.stringify(result).slice(0, 160));
const allowed = result.ok === true || result.ok === "timeout"; // timeout = no explicit rejection; echo may come anyway
if (!allowed) {
  console.log("CHAT GATED for guests — server said:", result.event?.secondary || result.event?.primary);
  for (const b of fleet) { try { b.c.close(); } catch {} }
  process.exit(2);
}

console.log(`[${stamp()}s] greeting with ${N} bots...`);
let echoed = 0, rejected = 0;
fleet[0].c.send("MyChatMessage", { isGroup: false, message: "hi from Claude Code — bosun-01" });
for (const b of fleet.slice(1)) {
  try { b.c.send("MyChatMessage", { isGroup: false, message: `hi from Claude Code — bosun-${String(b.i + 1).padStart(2, "0")}` }); } catch (e) { rejected++; }
  b.c.on("ChatMessage", (m) => { if (m.username === b.me.username) echoed++; });
  b.c.on("EventMessage", (m) => { if (m.eventMessageType === 2 && /chat/i.test((m.secondary || "") + (m.primary || ""))) rejected++; });
  await sleep(220); // 4-5 msgs/s — legible, not a flood
}
await sleep(4000);
console.log(`[${stamp()}s] sent=${N} self-echoes=${echoed} rejections=${rejected}`);
for (const b of fleet) { try { b.c.close(); } catch {} }
process.exit(0);
