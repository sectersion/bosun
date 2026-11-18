// Live friends/DM lifecycle: directory -> request -> accept -> list -> DM -> conversation
// -> notifications -> block/unblock -> remove -> positions. Prints raw server answers.
import { register, listServers } from "./index.js";
import { makeBot } from "./clans.js";
import { Friends, FRIEND_SORT } from "./friends.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cut = (o, n = 200) => JSON.stringify(o)?.slice(0, n) ?? String(o);
const step = async (t, fn) => { const v = await fn(); console.log(t.padEnd(28), cut(v)); return v; };

const servers = await listServers((await register()).id);
const server = servers.sort((a, b) => a.playerCount - b.playerCount)[0];
console.log(`server: ${server.serverName} (${server.playerCount} humans)\n`);

const mk = async (n) => { const b = await makeBot(n, server); b.friends = new Friends(b.client); return b; };
const A = await mk("friendA");
const B = await mk("friendB");
const C = await mk("stranger");
console.log(`A=${A.me.username} B=${B.me.username} C=${C.me.username}\n`);

try {
  await step("A.players(prefix=B)", async () => {
    const r = await A.friends.playersInServer(B.me.username.slice(0, 9));
    return r.playersInServer?.find((p) => p.gid === B.gid) ?? r;
  });
  await step("A.add(B)", () => A.friends.add(B.gid));
  await sleep(500);
  await step("B.requests(inbox)", () => B.friends.requests());
  await step("B.userInfo(A)", () => B.friends.userInfo(A.gid));
  await step("B.add(A)[accept?]", () => B.friends.add(A.gid));
  await sleep(400);
  await step("A.list", () => A.friends.list());
  await step("B.list", () => B.friends.list());
  await step("A.DM(B)", () => A.friends.sendDM(B.gid, "greetings from bot A"));
  await sleep(400);
  await step("B.conversation(A)", () => B.friends.conversation(A.gid));
  await step("B.inbox", () => B.friends.inbox());
  await step("B.notifications", () => B.friends.notifications());
  await step("A.DM(stranger C)", () => A.friends.sendDM(C.gid, "DM to non-friend"));
  await sleep(300);
  await step("A.block(B)", () => A.friends.block(B.gid));
  await step("B.userInfo(A) blocked?", () => B.friends.userInfo(A.gid));
  await step("A.blocked(list)", () => A.friends.blocked());
  await step("A.unblock(B)", () => A.friends.unblock(B.gid));
  await step("A.list(after unblock)", () => A.friends.list());
  await step("A.remove(B)", () => A.friends.remove(B.gid));
  await step("A.positions", () => A.friends.positions());
} catch (e) { console.log("FATAL:", e.message); }
finally { for (const b of [A, B, C]) b.client.close(); }
process.exit(0);
