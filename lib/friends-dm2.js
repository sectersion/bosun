// Round 2: verify DM-push hypothesis + friend-request inbox paging semantics.
import { register, listServers } from "./index.js";
import { makeBot } from "./clans.js";
import { Friends } from "./friends.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const servers = await listServers((await register()).id);
const server = servers.sort((a, b) => a.playerCount - b.playerCount)[0];

const mk = async (n) => { const b = await makeBot(n, server); b.friends = new Friends(b.client); b.pushes = []; b.client.on("FriendsResponse", (r) => b.pushes.push(r)); return b; };
const A = await mk("dmA"); const B = await mk("dmB"); const C = await mk("dmC");

console.log("-- friend-request inbox at page 0 --");
await A.friends.add(B.gid); await sleep(400);
B.pushes.length = 0;
console.log("B.requests(0):", JSON.stringify(await B.friends.requests(0)).slice(0, 200));
console.log("B pushes seen:", JSON.stringify(B.pushes).slice(0, 200));

// become friends (mutual add = accept)
await B.friends.add(A.gid); await sleep(400);

console.log("\n-- DM as async push: A sends, watch B's stream --");
B.pushes.length = 0;
const r = await A.friends.sendDM(B.gid, "push test hello");
console.log("sender got:", JSON.stringify(r));
await sleep(1500);
console.log("B pushed:", JSON.stringify(B.pushes).slice(0, 300));

console.log("\n-- conversation AFTER push (history read) --");
console.log("B.conversation(A):", JSON.stringify(await B.friends.conversation(A.gid)).slice(0, 300));
console.log("A.conversation(B):", JSON.stringify(await A.friends.conversation(B.gid)).slice(0, 300));

console.log("\n-- unread/notifications --");
console.log("B.notifications:", JSON.stringify(await B.friends.notifications()));
await B.friends.sendDM(A.gid, "reply from B"); await sleep(800);
console.log("A.notifications:", JSON.stringify(await A.friends.notifications()));
console.log("A.inbox:", JSON.stringify(await A.friends.inbox()).slice(0, 300));

console.log("\n-- stranger DM (C not friends): does C get a push? --");
C.pushes.length = 0;
await A.friends.sendDM(C.gid, "can strangers receive?"); await sleep(1200);
console.log("C pushed:", JSON.stringify(C.pushes).slice(0, 200) || "nothing");
console.log("A.conversation(C):", JSON.stringify(await A.friends.conversation(C.gid)).slice(0, 200));

for (const b of [A, B, C]) b.client.close();
process.exit(0);
