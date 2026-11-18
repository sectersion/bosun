// Crew lifecycle probe: request-gated rejection, invite-token joins, then
// transfer(5)/kick(6)/leave(4) — logs every MyCrewResponse transition and every
// EventMessage verbatim across all three bots. Self-closes < 60s.
import { register, listServers, setName, GameClient } from "../index.js";

const CREW = { requestJoin: 2, acceptJoin: 3, leave: 4, transfer: 5, kick: 6 };
const PORT = 1; // respawn at port; fresh guest -> auto solo crew
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const el = () => String(Date.now() - t0).padStart(5, " ");
const log = (...a) => console.log(el(), ...a);

const bots = []; // {name,me,client,latest,gid,inviteToken,events:[],crews:[]}

function sig(c) {
  return (
    `grp=${c.groupId ?? ""} leader=${(c.leaderGid || "").slice(0, 6)} ` +
    `tok=${(c.inviteToken || "").slice(0, 6)} ` +
    `members=[${(c.members || []).map((m) => m.username + (m.isLeader ? "*" : "")).join(",")}]`
  );
}

function attach(name, client) {
  const b = bots.find((x) => x.name === name);
  client.on("MyCrewResponse", (c) => {
    b.latest = c;
    const s = sig(c);
    b.crews.push(s);
    log(`[${name}] Crew  ${s}`);
  });
  client.on("EventMessage", (m) => {
    b.events.push(m);
    log(`[${name}] EVENT ${JSON.stringify(m)}`);
  });
  client.on("CrewJoinRequestMessage", (m) => log(`[${name}] JoinReq ${JSON.stringify(m)}`));
  client.on("DisconnectReason", (m) => log(`[${name}] DiscRea ${JSON.stringify(m)}`));
  client.on("error", (e) => log(`[${name}] err ${e.message}`));
  client.on("close", (e) => log(`[${name}] ws-close ${JSON.stringify(e)}`));
}

async function spawn(name, server) {
  const me = await register();
  await setName(me.id, name);
  const client = new GameClient({ id: me.id, server });
  const b = { name, me, client, latest: null, events: [], crews: [] };
  bots.push(b);
  attach(name, client);
  await client.connect();
  // first MyCrewResponse = our solo crew (leader = self)
  await Promise.race([new Promise((r) => client.once("MyCrewResponse", r)), sleep(6000)]);
  client.send("RequestRespawnMessage", { location: PORT });
  b.gid = b.latest?.leaderGid;
  b.inviteToken = b.latest?.inviteToken;
  log(`[${name}] up id=${me.id} gid=${b.gid} token=${(b.inviteToken || "").slice(0, 8)}`);
  return b;
}

const cleanup = () => { for (const b of bots) { try { b.client.close(); } catch {} } };
const watchdog = setTimeout(() => { log("!! WATCHDOG 55s"); cleanup(); process.exit(1); }, 55000);

try {
  const servers = await listServers((await register()).id);
  const pool = servers.filter((s) => [3, 4, 5].includes(s.serverId));
  const server = pool.reduce((a, s) => (s.playerCount < a.playerCount ? s : a));
  log(`server=${server.serverId}(${server.playerCount}) pool=[${pool.map((s) => `${s.serverId}:${s.playerCount}`).join(" ")}]`);

  const A = await spawn("crewsA", server);
  await sleep(1500);
  const B = await spawn("crewsB", server);
  await sleep(1500);
  const C = await spawn("crewsC", server);
  await sleep(1500);

  log("== STEP1 B.requestJoin(A) WITHOUT accept-requests checkbox ==");
  B.client.send("CrewRequest", { action: CREW.requestJoin, targetGid: A.gid });
  await sleep(2500);

  log("== STEP2 B,C join A via invite token ==");
  B.client.send("MyGroupMessage", { inviteToken: A.inviteToken });
  await sleep(1500);
  C.client.send("MyGroupMessage", { inviteToken: A.inviteToken });
  await sleep(2000);

  log("== STEP3 A.transfer -> B (5) ==");
  A.client.send("CrewRequest", { action: CREW.transfer, targetGid: B.gid });
  await sleep(2000);

  log("== STEP4 C.transfer -> A (requests leadership back) (5) ==");
  C.client.send("CrewRequest", { action: CREW.transfer, targetGid: A.gid });
  await sleep(2000);

  log("== STEP5 A.kick -> C (6) ==");
  A.client.send("CrewRequest", { action: CREW.kick, targetGid: C.gid });
  await sleep(2000);

  log("== STEP6 B.leave (4) ==");
  B.client.send("CrewRequest", { action: CREW.leave });
  await sleep(2000);

  log("=========== REPORT ===========");
  log(`gids  A=${A.gid}  B=${B.gid}  C=${C.gid}`);
  log(`names A=${A.me.username} B=${B.me.username} C=${C.me.username}`);
  log(`-- A.crews timeline (${A.crews.length}) --`);
  A.crews.forEach((s, i) => log(`   #${i} ${s}`));
  log(`-- B.crews timeline (${B.crews.length}) --`);
  B.crews.forEach((s, i) => log(`   #${i} ${s}`));
  log(`-- C.crews timeline (${C.crews.length}) --`);
  C.crews.forEach((s, i) => log(`   #${i} ${s}`));
  log(`-- events --`);
  for (const b of bots) log(`   ${b.name}: ${JSON.stringify(b.events)}`);
} catch (e) {
  log("!! ERROR", e.stack || e.message);
}
clearTimeout(watchdog);
cleanup();
await sleep(400);
process.exit(0);
