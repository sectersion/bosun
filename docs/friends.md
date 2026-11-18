# Friends & Direct-Messaging API — verified live 2026-11-17

Same one-message/one-verb design as clans: `FriendsRequest` (type 36) with 14 optional
fields, one per action; `FriendsResponse` (37) answers with payload **or invalidation
flags**; user-visible errors arrive as `EventMessage`. Wrapper: `lib/friends.js`
(`new Friends(client)`); live proof: `friends-lifecycle.js`, `friends-dm2.js`.

## Verified semantics

- **Request**: `addFriendGid` → sender gets Event "Friend request sent"; recipient gets a
  **live `FriendsResponse` push** containing the `friendRequests` entry — no polling needed.
- **Accept = the same verb**: `addFriendGid` toward someone who already requested you
  → Event "Friend added", mutual. There is no separate accept field. `rejectFriendRequestGid`
  declines. `requestFriendRequests` takes a **page** number (0-based), not a count.
- **List**: `requestFriends {prefix, sort, page}` → `friendsList[{gid, username, level,
  lastOnline, serverName}]` — `serverName` tells you which game server they're on.
- **Relationship state**: `relativeUserInfoGid` → `{gid, isFriends?, isBlocking?,
  isFriendRequested?}` — false flags are omitted (proto3 defaults dropped), treat absence as false.
- **Block is destructive**: `blockGid` → `{blockedUsersStale:true}` **and silently removes the
  friendship** — `unblockGid` does not restore it (verified: post-unblock `requestFriends` →
  `clearFriendsList`). Block-list read paginates via `requestBlocked {page}`.
- **Ack = stale flags**: `friendRequestsStale`, `friendsListStale`, `blockedUsersStale`,
  `relativeInfoStale` — the client re-fetches; there are no success bodies for mutations.
- **Presence push**: on connect every client receives `FriendGids` (43) — the friend gid list
  (empty `{}` when none) — separate from the FriendsResponse channel.
- **Directory**: `requestPlayersInServer {prefix, sort, page}` → `{gid, username, level}` rows —
  a global player search, prefix-filtered. Sort enum (from bundle): players `score=0,
  username=1, level=2`; friends/clans share `lastOnline=0, pointsContributed=1, level=2,
  admin=3, username=4` (the same enum fixes `CLAN_SORT` in clans.md).
- **Positions**: separate verbs `GetFriendAndClanMemberPositions` (38) `{gimme:true}` →
  `FriendAndClanMembersMapPositions` (39) `{positions[], group_ship?}`; `{}` when you have
  no friends/clan with actors in world.

## Direct messages — wire-complete, functionally blocked

`sendDirectMessage {toGid, content}`, `requestDirectMessagesWithGid`,
`requestFriendsWithMessages` (inbox), and the `unreadMessages` notification flag all encode
and send cleanly, but across three escalating tests — guest friends, registered-account
friends with real usernames, **alive in-game friends** — delivery produced: no sender ack, no
recipient push, and the reads (`conversation`, `inbox`) never answered **at all** (not even a
`clearConversation`). The client bundle has a `Messaging=4` UI tab, so the subsystem exists —
it is gated server-side by something we haven't identified (candidate: minimum level, since
every test account is level 1). Marked **blocked** in coverage; retest with a leveled account.

## Quickstart

```js
import { register, listServers } from "./index.js";
import { makeBot } from "./clans.js";           // persisted+spawned bot plumbing
import { Friends } from "./friends.js";
const b = await makeBot("mybot", server);
const f = new Friends(b.client);
await f.add(targetGid);                          // request or accept, symmetric
const { friendsList } = await f.list();          // [{gid, username, level, serverName, …}]
```
