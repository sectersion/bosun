// Fleet cost model: connect N bots to the emptiest server, measure per-bot
// bytes/s (down/up), RSS delta, and decode headroom. ~25s, self-closing.
import { register, listServers, GameClient } from "./index.js";

const N = Number(process.argv[2] ?? 4);
const DURATION = 20_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const base = process.memoryUsage().rss;
const servers = await listServers((await register()).id);
const server = servers.sort((a, b) => a.playerCount - b.playerCount)[0];
console.log(`server ${server.serverName} (${server.playerCount} humans), ${N} bots, ${DURATION / 1000}s`);

const stats = [];
for (let i = 0; i < N; i++) {
  const me = await register();
  const c = new GameClient({ id: me.id, server });
  const s = { down: 0, up: 0, msgs: 0, sent: 0 };
  stats.push(s);
  await c.connect();
  const sizeOf = (b) => (b?.size ?? b?.length ?? b?.byteLength ?? 0) || 0; // Blob.size / Buffer.length / ArrayBuffer.byteLength
  // observe-only: count real frame bytes both directions
  const origSend = c.send.bind(c);
  c.send = (t, o) => { const r = origSend(t, o); s.sent++; return r; };
  c.ws.addEventListener("message", (ev) => { s.down += sizeOf(ev.data); s.msgs++; });
  const os = c.ws.send.bind(c.ws);
  c.ws.send = (b) => { s.up += sizeOf(b); return os(b); };
  // mimic a real idle client's uplink so tick rates are realistic
  const crew = await new Promise((r) => c.once("MyCrewResponse", r));
  c.send("RequestRespawnMessage", { location: 1 });
  let interp = 0;
  setInterval(() => { try { c.send("MyTankMessage", { id: 1, interpolationIndex: ++interp, clientPressedSomethingForAntiAfk: true }); } catch {} }, 100).unref();
  await sleep(400);
}
const t0 = process.memoryUsage().rss;
await sleep(DURATION);
const t1 = process.memoryUsage().rss;
const cpu = process.cpuUsage();

let down = 0, up = 0, msgs = 0;
for (const s of stats) { down += s.down; up += s.up; msgs += s.msgs; }
const per = (b) => (b / N / (DURATION / 1000)).toFixed(0);
console.log(`down: ${per(down)} B/s per bot | up: ${per(up)} B/s | msgs: ${(msgs / N / (DURATION / 1000)).toFixed(1)}/s`);
console.log(`RSS: base ${(base / 1e6).toFixed(1)}MB, with ${N} bots ${(t0 / 1e6).toFixed(1)}MB, after ${DURATION / 1000}s ${(t1 / 1e6).toFixed(1)}MB`);
console.log(`bot cost ~${((t0 - base) / N / 1e6).toFixed(2)} MB startup, growth ${((t1 - t0) / N / 1e6).toFixed(2)} MB/bot/${DURATION / 1000}s (leak or state)`);
console.log(`cpu over window: user ${(cpu.user / 1e3 / N).toFixed(1)}ms/bot, sys ${(cpu.system / 1e3 / N).toFixed(1)}ms/bot`);
process.exit(0);
