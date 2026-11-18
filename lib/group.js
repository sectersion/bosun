// M3 demo: register N bots on ONE server and auto-group them into a single crew.
// Uses CrewGetOpenCrews to learn the anchor's authoritative leader_gid, then
// each other bot sends CrewRequestJoin; the anchor answers every
// CrewJoinRequestMessage with CrewAcceptJoin.
import { register, listServers, setName, GameClient } from "./index.js";

export const CREW = { getOpenCrews: 0, getMyCrew: 1, requestJoin: 2, acceptJoin: 3, leave: 4, transfer: 5, kick: 6 };
export const RESPAWN = { havana: 0, port: 1, yourShip: 2, jungle: 3 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bot(name, server, verbose, displayName) {
  const me = await register();
  if (displayName) await setName(me.id, displayName);
  const client = new GameClient({ id: me.id, server });
  client.on("error", (e) => console.error(`[${name}]`, e.message));
  if (verbose) client.on("message", ({ name: n, msg }) => {
    if (!["WorldMessage", "CannonBallMessage", "RemoveCannonBall", "ScoresMessage", "GlobalExplosion"].includes(n))
      console.log(`    [${name}] < ${n}`, JSON.stringify(msg)?.slice(0, 140));
  });
  await client.connect();
  const crew = await new Promise((r) => client.once("MyCrewResponse", r));
  client.send("RequestRespawnMessage", { location: RESPAWN.port });
  const state = { name, me, client, gid: crew.leaderGid, inviteToken: crew.inviteToken, latestCrew: crew };
  client.on("MyCrewResponse", (c) => { state.latestCrew = c; }); // keep newest post-join state
  console.log(`[${name}] ${displayName ?? me.username} gid=${crew.leaderGid} @ ${server.serverName}`);
  return state;
}

const args = process.argv.slice(2);
const link = args.includes("--link") ? args[args.indexOf("--link") + 1] : null;
const prefix = args.includes("--prefix") ? args[args.indexOf("--prefix") + 1] : "kraken";
const N = Number(args.find((a) => /^\d+$/.test(a)) ?? 3);

const servers = await listServers((await register()).id);
let server, token;
if (link) { // invite URL: ?saltySeasServerName=Server%201&saltySeasTime=<ms>&saltySeasGroupId=<token>
  const q = new URL(link).searchParams;
  if (Number(q.get("saltySeasTime") ?? 0) < Date.now() - 864e5) throw new Error("invite expired (>24h)");
  token = q.get("saltySeasGroupId");
  server = servers.find((s) => s.serverName === q.get("saltySeasServerName")) ?? servers[0];
  console.log(`joining leader's crew @ ${server.serverName} via invite token ${token}`);
} else {
  server = servers.reduce((a, b) => (b.playerCount < a.playerCount ? b : a));
}
const bots = [];
for (let i = 0; i < N; i++) {
  const displayName = `${prefix}-${i + 1}`.slice(0, 16); // server truncates usernames to 16 chars
  bots.push(await bot(`bot${i + 1}`, server, link ? null : i > 0, displayName));
  await sleep(1500);
}

if (link) { // everyone joins the human leader, no local anchor
  for (const b of bots) b.client.send("MyGroupMessage", { inviteToken: token });
  await sleep(4000);
  const leaders = new Set(bots.map((b) => b.latestCrew?.leaderGid));
  for (const b of bots) console.log(`[${b.name}] leader=${b.latestCrew?.leaderGid ?? "?"} members=${b.latestCrew?.members?.map((m) => m.username).join(",") ?? "?"}`);
  console.log(leaders.size === 1 && leaders.has([...leaders][0]) && [...bots][0].gid !== [...leaders][0]
    ? `SUCCESS: ${bots.length} bots joined crew leader ${[...leaders][0]} (your gid)`
    : (leaders.size === 1 ? `all in one crew (leader ${[...leaders][0]})` : `split across ${leaders.size} crews`));
  for (const b of bots) b.client.close();
  process.exit(0);
}

const [anchor, ...others] = bots;
anchor.client.on("CrewJoinRequestMessage", (m) => {
  console.log(`[${anchor.name}] join request from ${m.requesterUsername}`);
  anchor.client.send("CrewRequest", { action: CREW.acceptJoin, targetGid: m.requesterGid });
});
let anchorCrew = null;
anchor.client.on("MyCrewResponse", (c) => {
  anchorCrew = c;
  console.log(`[${anchor.name}] crew: ${c.members?.map((m) => `${m.username}${m.isLeader ? "*" : ""}`).join(",")}`);
});

// Invite-token join: the leader's MyCrewResponse.inviteToken, when sent by anyone as
// MyGroupMessage{inviteToken}, drops them straight into that crew — no request/accept
// dance (which the server rejects for shipless solo crews with "not accepting requests").
for (const b of others) {
  b.client.send("MyGroupMessage", { inviteToken: anchor.inviteToken });
  await sleep(2000);
}

await sleep(4000);
console.log(anchorCrew?.members?.length >= N ? `SUCCESS: ${anchorCrew.members.length} bots in one crew` : `incomplete (crew=${anchorCrew?.members?.length ?? 1})`);
for (const b of bots) b.client.close();
process.exit(0);
