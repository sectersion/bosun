// spectators probe — live prod. One fresh guest on least-populated of servers 3/4/5.
// Exercises: RequestJoinSpectators(55), LeaveSpectators(65), PlaceGroupFlagMessage(71),
// ModToolsRequest(40), TestingMessage(4); enumerates every EventMessage.eventMessageType.
// Self-closes well within 60s. Rejections are the findings — logged verbatim, never retried.
import { register, listServers, setName, GameClient } from "../index.js";

const RESPAWN = { havana: 0, port: 1, yourShip: 2, jungle: 3 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const J = (v) => { try { return JSON.stringify(v); } catch { return String(v); } };

const HARD_DEADLINE = setTimeout(() => { log("!! hard 55s deadline — forcing exit"); process.exit(0); }, 55000);

// 1. least-populated of servers 3/4/5
const me0 = await register();
const servers = await listServers(me0.id);
const cands = servers.filter((s) => [3, 4, 5].includes(s.serverId));
if (!cands.length) { log("!! no servers 3/4/5 in list:", J(servers.map((s) => s.serverId))); process.exit(1); }
const server = cands.reduce((a, b) => (b.playerCount < a.playerCount ? b : a));
log(`server pick: id=${server.serverId} "${server.serverName}" players=${server.playerCount}/${server.maxPlayerCount}`);

// 2. one fresh guest
const me = await register();
const displayName = "spec-probe";
let prof = me;
try { prof = await setName(me.id, displayName); } catch (e) { log("setName err", e.message); }
log(`guest id=${me.id} username=${prof.username ?? me.username} canSpectate=${prof.canSpectate} selectedShip=${J(prof.selectedShip)}`);

// 3. collectors
const typeHist = new Map();           // message name -> count (server->client)
const eventTypes = new Map();         // eventMessageType -> first full EventMessage seen
const probeResponses = {              // what each probe drew back, tagged
  RequestJoinSpectators: [], LeaveSpectators: [], PlaceGroupFlagMessage: [],
  ModToolsRequest: [], TestingMessage: [], RequestRespawn: [],
};
let curProbe = null;
const record = () => { if (curProbe && probeResponses[curProbe]) probeResponses[curProbe].push("tick"); };

const client = new GameClient({ id: me.id, server });
client.on("error", (e) => log("  [ws-err]", e.message));
client.on("close", (e) => log(`  [CLOSE] code=${e.code} reason="${e.reason}"`));

client.on("message", ({ name, msg }) => {
  typeHist.set(name, (typeHist.get(name) ?? 0) + 1);
  // high-freq ticks: don't spam
  if (name === "WorldMessage" || name === "CannonBallMessage" || name === "RemoveCannonBall" || name === "ScoresMessage" || name === "GlobalExplosion") return;
  log(`  < ${name}`, J(msg)?.slice(0, 200));
  if (name === "EventMessage") {
    const t = msg.eventMessageType ?? 0;
    if (!eventTypes.has(t)) eventTypes.set(t, msg);
    log(`    >> EventMessage type=${t} primary="${msg.primary}" secondary="${msg.secondary}"`);
  }
  if (name === "DisconnectReason") log(`    >> DisconnectReason reason=${msg.reason} desc="${msg.description}"`);
  record();
});

await client.connect();
log("handshake OK (Init sent, LazyLoader auto at ~1.24s)");
await sleep(1600); // let ServerConstants / crew / first EventMessage land

// 4. RequestJoinSpectators (55) — expect canSpectate:false rejection for a guest
curProbe = "RequestJoinSpectators"; log("\n=== RequestJoinSpectators(55) {foo:true} ===");
try { client.send("RequestJoinSpectators", { foo: true }); } catch (e) { log("send err", e.message); }
await sleep(2500);

// 5. LeaveSpectators (65)
curProbe = "LeaveSpectators"; log("\n=== LeaveSpectators(65) {foo:true} ===");
try { client.send("LeaveSpectators", { foo: true }); } catch (e) { log("send err", e.message); }
await sleep(2000);

// 6. ModToolsRequest (40) — empty object
curProbe = "ModToolsRequest"; log("\n=== ModToolsRequest(40) {} ===");
try { client.send("ModToolsRequest", {}); } catch (e) { log("send err", e.message); }
await sleep(2000);

// 7. TestingMessage (4) — dummy sphere per proto; see if server echoes or ignores
curProbe = "TestingMessage"; log("\n=== TestingMessage(4) dummy sphere ===");
try { client.send("TestingMessage", { id: "probe-sphere-1", x: 0, y: 5, z: 0, scale: 2, color: 0xff0000 }); } catch (e) { log("send err", e.message); }
await sleep(2000);

// 8. respawn then PlaceGroupFlagMessage (71) as (solo-crew) leader at own-ship location
curProbe = "RequestRespawn"; log("\n=== RequestRespawnMessage(26) {location:yourShip} then PlaceGroupFlag(71) ===");
let crew = null;
client.once("MyCrewResponse", (c) => { crew = c; });
try { client.send("RequestRespawnMessage", { location: RESPAWN.yourShip }); } catch (e) { log("send err", e.message); }
const state = await new Promise((r) => { client.once("ResetYourState", r); setTimeout(() => r(null), 5000); });
log("ResetYourState:", state ? `yourTank=${J(state.yourTank)?.slice(0,160)} mapSize=${state.mapSize}` : "(none in 5s)");
log("MyCrewResponse:", crew ? `groupId=${crew.groupId} leaderGid=${crew.leaderGid} members=${(crew.members||[]).map(m=>`${m.username}${m.isLeader?"*":""}`).join(",")} ship=${J(crew.ship)}` : "(none)");
const iAmLeader = crew && crew.members?.some((m) => m.isLeader);
log(`am-crew-leader=${!!iAmLeader}`);

curProbe = "PlaceGroupFlagMessage"; log("\n--- PlaceGroupFlagMessage(71) {foo:true} ---");
try { client.send("PlaceGroupFlagMessage", { foo: true }); } catch (e) { log("send err", e.message); }
await sleep(3000);

// 9. report
curProbe = null;
log("\n========== SPECTATORS PROBE SUMMARY ==========");
log("message types seen (server->client):");
for (const [n, c] of [...typeHist.entries()].sort((a, b) => b[1] - a[1])) log(`  ${String(c).padStart(4)}x ${n}`);
log("\nEventMessage eventMessageType values observed:");
if (!eventTypes.size) log("  (none)");
for (const [t, m] of [...eventTypes.entries()].sort((a, b) => a[0] - b[0])) log(`  type=${t}  ${J(m)}`);
log("\nprobe -> responses seen while awaiting each (non-tick msgs tagged 'tick' = any handled frame):");
for (const [k, v] of Object.entries(probeResponses)) log(`  ${k}: ${v.length} frame(s) drawn`);

client.close();
clearTimeout(HARD_DEADLINE);
process.exit(0);
