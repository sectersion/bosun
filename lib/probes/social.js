// social probe — clans/friends/medals/chat/stats/tutorials.
// 2 guest bots on the emptiest of servers 3/4/5. Self-closes < 60s.
import { register, listServers, setName, GameClient } from "../index.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// messages we care about: print full, others truncated (noisy ticks)
const INTEREST = new Set([
  "ClanMiscResponse", "FriendsResponse", "FriendAndClanMembersMapPositions",
  "MedalsResponse", "PlayerMedalsResponse", "ChatMessage", "FlushStatsMessage",
  "MyChatMessage", "ResetYourState", "EventMessage", "DisconnectReason",
]);

function makeLogger(tag) {
  return ({ name, msg }) => {
    if (!INTEREST.has(name)) return; // skip WorldMessage/CannonBall/etc.
    console.log(`[${tag}] < ${name}`, JSON.stringify(msg));
  };
}

// register -> connect -> respawn -> own gid. Returns { id, client, gid, name }.
async function bot(tag, server, username) {
  const me = await register();
  await setName(me.id, username);
  const client = new GameClient({ id: me.id, server });
  client.on("error", (e) => console.log(`[${tag}] ERROR`, e.message));
  client.on("close", (e) => console.log(`[${tag}] CLOSE`, JSON.stringify(e)));
  client.on("message", makeLogger(tag));
  await client.connect();

  // own gid: solo crew auto-groups, so MyCrewResponse.leaderGid === my gid.
  let gid = null;
  const crew = await Promise.race([
    client.once2("MyCrewResponse"),
    sleep(4000).then(() => null),
  ]);
  if (crew?.leaderGid) gid = crew.leaderGid;

  client.send("RequestRespawnMessage", { location: 1 }); // port
  const state = await Promise.race([
    client.once2("ResetYourState"),
    sleep(4000).then(() => null),
  ]);
  if (state?.yourTank?.gid) gid = state.yourTank.gid; // authoritative once spawned
  client.gid = gid;
  console.log(`[${tag}] ${username} id=${me.id} gid=${gid} @ ${server.serverName}`);
  return { tag, me, client, gid, username };
}

// once2: promise that resolves on next named event (EventEmitter.once lacks promise wrap).
GameClient.prototype.once2 = function (ev) {
  return new Promise((r) => this.once(ev, r));
};

const servers = await listServers((await register()).id);
const pool = servers.filter((s) => [3, 4, 5].includes(s.serverId));
const server = (pool.length ? pool : servers).reduce((a, b) => (b.playerCount < a.playerCount ? b : a));
console.log(`server -> ${server.serverId} "${server.serverName}" players=${server.playerCount}`);

const A = await bot("A", server, "soc-A-probe");
const B = await bot("B", server, "soc-B-probe");

await sleep(1500); // let spawns settle before firing social queries

// ---- ClanRequest (35) from A -> ClanMiscResponse (34) ----
console.log("[A] > ClanRequest list_clans");
A.client.send("ClanRequest", { listClans: true });
await sleep(700);
console.log("[A] > ClanRequest my_full_info");
A.client.send("ClanRequest", { myFullInfo: true });
await sleep(700);

// ---- FriendsRequest (36) empty list -> FriendsResponse (37) ----
console.log("[A] > FriendsRequest (empty list)");
A.client.send("FriendsRequest", { requestFriends: { prefix: "", sort: 0, page: 0 } });
await sleep(700);

// ---- GetFriendAndClanMemberPositions (38) -> (39) ----
console.log("[A] > GetFriendAndClanMemberPositions");
A.client.send("GetFriendAndClanMemberPositions", { gimme: true });
await sleep(700);

// ---- medals: GetMedalsRequest (61) -> (62); own gid (63) -> (64) ----
console.log("[A] > GetMedalsRequest");
A.client.send("GetMedalsRequest", { foo: true });
await sleep(700);
console.log(`[A] > GetPlayerMedalsRequest gid=${A.gid}`);
A.client.send("GetPlayerMedalsRequest", { gid: A.gid });
await sleep(700);

// ---- chat: one global, one group (B) -> ChatMessage (8) echoes ----
console.log("[A] > MyChatMessage GLOBAL");
A.client.send("MyChatMessage", { isGroup: false, message: "social-global-hi" });
await sleep(700);
console.log("[B] > MyChatMessage GROUP");
B.client.send("MyChatMessage", { isGroup: true, message: "social-group-hi" });
await sleep(1000);

// ---- stats / tutorials ----
console.log("[A] > FlushStatsMessage");
A.client.send("FlushStatsMessage", { foo: true });
await sleep(500);
console.log("[A] > TutorialsSeenMessage dummy");
A.client.send("TutorialsSeenMessage", { steering: true });
await sleep(500);

console.log("done, closing");
A.client.close();
B.client.close();
process.exit(0);

// hard watchdog: never outlive 55s
setTimeout(() => { console.log("WATCHDOG close"); try { A.client.close(); B.client.close(); } catch {} process.exit(0); }, 55000);
