// Fleet PoC: summon N bots (register + name + connect + spawn), keep for T, report.
// usage: node fleet.js [N] [serverName] [holdSeconds]
import { register, setName, listServers, GameClient } from "../lib/index.js";

const N = Number(process.argv[2] || 50);
const wantServer = process.argv[3] || null;
const HOLD = Number(process.argv[4] || 90) * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const stamp = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6);

const servers = await listServers((await register()).id);
const server = (wantServer ? servers.find((s) => s.serverName === wantServer) : null)
  ?? servers.slice().sort((a, b) => a.playerCount - b.playerCount)[0];
console.log(`[${stamp()}s] target ${server.serverName} ${server.playerCount}/${server.maxPlayerCount}, summoning ${N}`);
if (server.maxPlayerCount - server.playerCount < N) console.log(`  NOTE: only ${server.maxPlayerCount - server.playerCount} free slots — expect ServerFull bounces`);

// phase 1: identity factory (sequential-ish to stay polite on REST)
const fleet = [];
for (let i = 0; i < N; i++) {
  try {
    const me = await register();
    await setName(me.id, `bosun-${String(i + 1).padStart(2, "0")}`);
    fleet.push({ i, me });
  } catch (e) { console.log(`[${stamp()}s] register #${i + 1} failed: ${e.message}`); }
  if ((i + 1) % 10 === 0) console.log(`[${stamp()}s] registered ${i + 1}/${N} RSS=${(process.memoryUsage().rss / 1e6).toFixed(0)}MB`);
}

// phase 2: connect staggered, spawn on port, track outcomes
const stats = { in: 0, handshakeOnly: 0, full: 0, err: 0, bytesDown: 0, bytesUp: 0 };
for (const b of fleet) {
  try {
    const c = new GameClient({ id: b.me.id, server });
    b.client = c;
    c.on("close", ({ code }) => { if (code !== 1000) stats.err++; });
    c.on("DisconnectReason", (m) => { if (m.reason === 12) stats.full++; else stats.err++; });
    c.once("MyCrewResponse", () => { stats.in++; c.send("RequestRespawnMessage", { location: 1 }); });
    await c.connect();
    // byte counters
    const sz = (x) => (x?.size ?? x?.length ?? x?.byteLength ?? 0) || 0;
    c.ws.addEventListener("message", (e) => { stats.bytesDown += sz(e.data); });
    const snd = c.ws.send.bind(c.ws); c.ws.send = (d) => { stats.bytesUp += sz(d); return snd(d); };
  } catch (e) { stats.err++; }
  await sleep(120); // connect cadence: not a SYN storm
  if ((b.i + 1) % 10 === 0) console.log(`[${stamp()}s] connected ${b.i + 1} in=${stats.in} RSS=${(process.memoryUsage().rss / 1e6).toFixed(0)}MB`);
}
console.log(`[${stamp()}s] all connected: in-world=${stats.in} handshake=${fleet.length - stats.in - stats.err} errors=${stats.err} — holding ${HOLD / 1000}s`);

await sleep(HOLD);
const secs = (Date.now() - t0) / 1000;
console.log(`[${stamp()}s] fleet live=${stats.in} | down ${(stats.bytesDown / 1e6).toFixed(1)}MB (${(stats.bytesDown / secs / 1e6).toFixed(2)}MB/s) | up ${(stats.bytesUp / 1e3).toFixed(0)}kB | RSS ${(process.memoryUsage().rss / 1e6).toFixed(0)}MB | cpu=${JSON.stringify(process.cpuUsage())}`);
for (const b of fleet) { try { b.client?.close(); } catch {} }
console.log("fleet dismissed");
process.exit(0);
