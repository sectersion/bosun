// Friends + Direct-Message system API — wrapper over the one-message/one-verb
// FriendsRequest protocol (type 36 -> FriendsResponse 37; errors via EventMessage;
// positions are a separate verb type 38 -> 39). Every method sends one FriendsRequest
// with exactly one field set and resolves the matching response.
// Silent-ack verbs (no FriendsResponse/EventMessage) resolve { silent: true }.
// See docs/friends.md + docs/game.proto (FriendsRequest / FriendsResponse).

// Sort enums recovered from the game bundle (shared family with clans).
export const FRIEND_SORT = { lastOnline: 0, pointsContributed: 1, level: 2, admin: 3, username: 4 };
export const PLAYER_SORT = { score: 0, username: 1, level: 2 };

export class Friends {
  constructor(client) {
    this.c = client;
    this.type = "FriendsRequest";   // which request message the verbs ride on
  }

  _ask(reqType, fields, respTypes) {
    return new Promise((resolve, reject) => {
      const to = setTimeout(() => { off(); resolve({ silent: true }); }, 8000);
      const onResp = (r) => { off(); resolve(r); };
      const onEvent = (e) => { off(); resolve({ event: e }); };
      const handlers = respTypes.map((t) => [t, onResp]);
      function off() {
        clearTimeout(to);
        for (const [t, h] of handlers) c.removeListener(t, h);
        c.removeListener("EventMessage", onEvent);
      }
      const c = this.c;
      for (const [t, h] of handlers) c.on(t, h);
      c.on("EventMessage", onEvent);
      try { c.send(reqType, fields); } catch (e) { off(); reject(e); }
    });
  }

  // ---- presence / directory ----
  playersInServer(prefix = "", sort = PLAYER_SORT.username, page = 0) {
    return this._ask(this.type, { requestPlayersInServer: { prefix, sort, page } }, ["FriendsResponse"]);
  }
  // ---- friends graph ----
  /** THE friend verb: to a stranger = send request; to someone who requested YOU = accept (verified: mutual add -> "Friend added") */
  add(gid) { return this._ask(this.type, { addFriendGid: gid }, ["FriendsResponse"]); }
  reject(gid) { return this._ask(this.type, { rejectFriendRequestGid: gid }, ["FriendsResponse"]); }
  remove(gid) { return this._ask(this.type, { removeFriendGid: gid }, ["FriendsResponse"]); }
  list(prefix = "", sort = FRIEND_SORT.username, page = 0) {
    return this._ask(this.type, { requestFriends: { prefix, sort, page } }, ["FriendsResponse"]);
  }
  requests(page = 0) { return this._ask(this.type, { requestFriendRequests: page }, ["FriendsResponse"]); } // -> { friendRequests:[{gid,username,level,outgoing,created}] }
  userInfo(gid) { return this._ask(this.type, { relativeUserInfoGid: gid }, ["FriendsResponse"]); } // -> { relativeUserInfo:{isBlocking,isFriends,isFriendRequested} }

  // ---- block list ----
  block(gid) { return this._ask(this.type, { blockGid: gid }, ["FriendsResponse"]); }
  unblock(gid) { return this._ask(this.type, { unblockGid: gid }, ["FriendsResponse"]); }
  blocked(page = 0) { return this._ask(this.type, { requestBlocked: { page } }, ["FriendsResponse"]); }

  // ---- direct messages ----
  sendDM(toGid, content) { return this._ask(this.type, { sendDirectMessage: { toGid, content } }, ["FriendsResponse"]); }
  conversation(gid) { return this._ask(this.type, { requestDirectMessagesWithGid: gid }, ["FriendsResponse"]); } // -> { conversation:[DirectMessage] }
  inbox(prefix = "", page = 0) { return this._ask(this.type, { requestFriendsWithMessages: { prefix, page } }, ["FriendsResponse"]); } // -> { friendsWithMessages }
  notifications() { return this._ask(this.type, { getFriendNotifications: true }, ["FriendsResponse"]); } // -> { friendNotifications:{unreadMessages,incomingFriendRequests} }

  // ---- friend+clan map positions (separate verb type 38/39) ----
  positions() { return this._ask("GetFriendAndClanMemberPositions", { gimme: true }, ["FriendAndClanMembersMapPositions"]); }
}
