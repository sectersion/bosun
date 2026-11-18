// Live clan lifecycle: create -> discover -> join -> accept -> manage -> chat ->
// announce -> kick -> leave -> dismiss. Tolerates silent-ack verbs (no ClanMiscResponse)
// by catching timeouts and verifying state via a follow-up read. Cleans up after itself.
import { register, listServers } from "./index.js";
import { makeBot, CLAN_SORT } from "./clans.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cut = (o, n = 240) => JSON.stringify(o)?.slice(0, n) ?? String(o);
async function step(t, fn) {
  try { const v = await fn(); console.log(t.padEnd(30), cut(v)); return v; }
  catch (e) { console.log(t.padEnd(30), "… no response (silent verb)"); return null; }
}

const servers = await listServers((await register()).id);
const server = servers.sort((a, b) => a.playerCount - b.playerCount)[0];
console.log(`server: ${server.serverName} (${server.playerCount} humans)\n`);
const stamp = Date.now().toString(36).toUpperCase().slice(-2); // shortName hard cap: 5 chars

const owner = await makeBot("owner", server);
const joiner = await makeBot("joiner", server);
const third = await makeBot("third", server);

try {
  await step("create", () => owner.clan.create("CLW" + stamp, "Claw Probe " + stamp, "automation probe clan"));
  const my = await owner.clan.myInfo();
  const clanId = my.myClanInfo?.clanId;
  step.done = true;
  if (!clanId) { console.log("no clanId — gating response:", cut(my)); }
  else {
    console.log("owner clanId:", clanId, "amIOwner:", my.myClanInfo.amIOwner);
    await step("search(own tag)", async () => (await owner.clan.search("CLW" + stamp)).listedClans?.length ?? "no listedClans");
    await step("joiner.info", () => joiner.clan.info(clanId));
    await step("joiner.join", () => joiner.clan.join(clanId));
    await sleep(400);
    await step("owner.inbox", () => owner.clan.joinRequests(clanId));
    await step("owner.accept", () => owner.clan.accept(joiner.gid));
    await sleep(400);
    const j2 = await step("joiner.myInfo(after)", () => joiner.clan.myInfo());
    console.log("  -> joiner playerCount:", j2?.myClanInfo?.playerCount, "in clan:", j2?.myClanInfo?.clanId === clanId);

    // third joins, then gets kicked — and test silent-ack management verbs
    await third.clan.join(clanId); await sleep(300); await owner.clan.accept(third.gid); await sleep(400);
    await step("roster", async () => (await owner.clan.roster(clanId, CLAN_SORT.username))?.clanMemberDetails?.map((m) => m.username + (m.isOwner ? "*" : m.isAdmin ? "!" : "")));
    await step("owner.promote(joiner)", () => owner.clan.promote(joiner.gid));
    await sleep(200);
    await step("owner.setMinLevel(5)", () => owner.clan.setMinLevel(5));
    await step("  verify minLevel", async () => (await owner.clan.myInfo())?.myClanInfo?.minLevel);
    await step("roster(after promote)", async () => (await owner.clan.roster(clanId))?.clanMemberDetails?.map((m) => m.username + (m.isOwner ? "*" : m.isAdmin ? "!" : "")));
    await step("joiner.sendChat", () => joiner.clan.sendChat("probe msg from admin bot"));
    await sleep(400);
    await step("owner.chatHistory", async () => (await owner.clan.chatHistory(clanId))?.clanChatMessages?.map((m) => m.username + ": " + m.content));
    await step("owner.announce", () => owner.clan.createAnnouncement("Probe notice", "server runs at dawn"));
    await sleep(400);
    await step("joiner.announcements", async () => (await joiner.clan.announcements())?.announcements?.map((a) => a.title));
    await step("leaderboard(0,7)", () => owner.clan.leaderboard(0, 7));
    await step("owner.kick(third)", () => owner.clan.kick(third.gid));
    await sleep(400);
    await step("third.myInfo(kicked)", async () => (await third.clan.myInfo())?.myClanInfo ?? "clanless");
    await step("joiner.leave", () => joiner.clan.leave(clanId));
    await step("owner.dismiss", () => owner.clan.dismiss(clanId));
    await sleep(300);
    await step("owner.myInfo(dismissed)", async () => (await owner.clan.myInfo())?.myClanInfo ?? "clanless/cleared");
  }
} catch (e) { console.log("FATAL:", e.message); }
finally { for (const b of [owner, joiner, third]) b.client.close(); }
process.exit(0);
