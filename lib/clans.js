// Clan system API — a clean wrapper over the one-message/one-field ClanRequest protocol.
// Every method sends a ClanRequest and resolves with the next ClanMiscResponse.
// Field names are camelCase (protobufjs maps them to the snake_case proto).
// See docs/game.proto (ClanRequest / ClanMiscResponse) and docs/clans.md for semantics.

export const CLAN_SORT = { lastOnline: 0, pointsContributed: 1, level: 2, admin: 3, username: 4 };

export class Clans {
  constructor(client) { this.c = client; }

  /** send one ClanRequest verb; resolve with ClanMiscResponse, or {event} if the server answers EventMessage (validation/rejection) */
  _req(fields) {
    return new Promise((resolve, reject) => {
      const to = setTimeout(() => { off(); reject(new Error("clan response timeout: " + JSON.stringify(fields))); }, 8000);
      const onMisc = (r) => { off(); resolve(r); };
      const onEvent = (e) => { off(); resolve({ event: e }); };
      const off = () => { clearTimeout(to); this.c.removeListener("ClanMiscResponse", onMisc); this.c.removeListener("EventMessage", onEvent); };
      this.c.on("ClanMiscResponse", onMisc);
      this.c.on("EventMessage", onEvent);
      try { this.c.send("ClanRequest", fields); } catch (e) { off(); reject(e); }
    });
  }

  // ---- discovery / read ----
  list() { return this._req({ listClans: true }); }                       // -> { listedClans: [ListedClan] } (server-capped ~100)
  search(filter) { return this._req({ listClans: true, listClansFilter: filter }); }
  info(clanId) { return this._req({ clanInfoForId: clanId }); }           // -> { clanInfo: ClanInfo } (incl. requestedToJoin, isMember)
  myInfo() { return this._req({ myFullInfo: true }); }                    // -> { myClanInfo } or { clearMyClanInfo: true } if clanless
  roster(clanId, sortedBy = CLAN_SORT.username, page = 0) {               // -> { clanMemberDetails: [ClanMemberDetails] } paginated
    return this._req({ getClanMembersForClan: { clanId, sortedBy, page } });
  }
  joinRequests(clanId) { return this._req({ getRequestsToJoinClanId: clanId }); } // -> { requestsToJoin: [ClanRequestToJoin] } (admin)

  // ---- membership lifecycle ----
  create(shortName, longName, description) {                              // -> { createClanResponse: { errorMessage?|successMessage? } }
    return this._req({ createClanRequest: { shortName, longName, description } });
  }
  join(clanId) { return this._req({ requestToJoinClanId: clanId }); }
  accept(gid) { return this._req({ acceptGidJoining: gid }); }             // admin
  reject(gid) { return this._req({ rejectGidJoining: gid }); }            // admin
  clearRequests() { return this._req({ clearAllJoinRequests: true }); }    // admin
  leave(clanId) { return this._req({ leaveClan: clanId }); }               // proto: string field (clan id)
  dismiss(clanId) { return this._req({ deleteClan: clanId }); }            // owner
  edit({ shortName, longName, description } = {}) { return this._req({ shortName, longName, description }); } // owner/admin
  setMinLevel(n) { return this._req({ minLevel: n }); }                    // owner/admin

  // ---- officer management (owner/admin) ----
  promote(gid) { return this._req({ makeAdminGid: gid }); }
  demote(gid) { return this._req({ removeAdminGid: gid }); }
  kick(gid) { return this._req({ kickGid: gid }); }
  transfer(gid) { return this._req({ transferOwnership: gid }); }          // owner

  // ---- announcements (admin) ----
  createAnnouncement(title, description, { eventTime, repeats } = {}) {
    return this._req({ createAnnouncementRequest: { title, description, eventTime, repeats } });
  }
  announcements() { return this._req({ listAnnouncements: true }); }       // -> { announcements: [ClanAnnouncement] }
  readAnnouncements() { return this._req({ readAnnouncements: true }); }
  deleteAnnouncement(id) { return this._req({ announcementToDeleteId: id }); }

  // ---- clan chat ----
  sendChat(content) { return this._req({ createChatMessage: content }); }
  chatHistory(clanId) { return this._req({ getChatMessagesForClanId: clanId }); } // -> { clanChatMessages: [ClanChatMessage] }
  markChatRead() { return this._req({ markClanChatRead: true }); }
  deleteChat(messageId) { return this._req({ deleteChatMessage: messageId }); }

  // ---- leaderboard ----
  leaderboard(type, days) { return this._req({ leaderboardType: type, leaderboardDays: days }); } // -> { leaderboard }
}

// convenience: a connected bot with a Clans facade. gid comes from its auto solo-crew.
// persist=true also binds a recoverable email+password account (registration is free
// and instant) and appends it to fleet-accounts.json — identity survives crashes, so
// half-finished automations never orphan clans/ships/state.
import { register, registerAccount, GameClient } from "./index.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const ACCTS = new URL("./fleet-accounts.json", import.meta.url);

export function loadAccounts() { return existsSync(ACCTS) ? JSON.parse(readFileSync(ACCTS, "utf8")) : []; }
export function saveAccount(a) { const all = loadAccounts(); all.push(a); writeFileSync(ACCTS, JSON.stringify(all, null, 1)); }

export async function makeBot(name, server, { spawn = true, persist = true } = {}) {
  const me = await register();
  let acct = null;
  if (persist) {
    const pw = Math.random().toString(36).slice(2, 14);
    const email = `${name}.${Date.now().toString(36)}@salty.invalid`;
    await registerAccount(me.id, email, pw);
    acct = { name, id: me.id, email, pw, gid: null, at: new Date().toISOString() };
  }
  const client = new GameClient({ id: me.id, server });
  client.on("error", () => {});
  await client.connect();
  const crew = await new Promise((r) => client.once("MyCrewResponse", r));
  if (acct) { acct.gid = crew.leaderGid; saveAccount(acct); }
  if (spawn) {
    const respawned = new Promise((r) => {
      const on = (e) => { if (e.primary === "You have been respawned") { clearTimeout(t); client.removeListener("EventMessage", on); r(); } };
      const t = setTimeout(() => client.removeListener("EventMessage", on), 4000);
      client.on("EventMessage", on);
    });
    client.send("RequestRespawnMessage", { location: 1 });
    await respawned;
  }
  return { name, me, id: me.id, gid: crew.leaderGid, acct, client, clan: new Clans(client) };
}

/** Recover a persisted bot by account: login from a throwaway session, then connect as the canonical id. */
export async function recoverBot(email, pw, server, { spawn = true } = {}) {
  const tmp = await register();
  const prof = await (await import("./index.js")).login(tmp.id, email, pw);
  const client = new GameClient({ id: prof.id, server });
  client.on("error", () => {});
  await client.connect();
  const crew = await new Promise((r) => client.once("MyCrewResponse", r));
  return { name: prof.username, me: prof, id: prof.id, gid: crew.leaderGid, client, clan: new Clans(client) };
}
