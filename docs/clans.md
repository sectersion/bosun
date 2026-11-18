# Clan system API — verified live 2026-11-17

Everything is ONE message: `ClanRequest` (type 35) with 38 optional fields — set **exactly
one verb-field per request** (the real client merges into an all-null template). Replies come
as `ClanMiscResponse` (type 34); **validation/rejection errors arrive as `EventMessage`
(eventMessageType 2)**, not as an error in the misc response. Library wrapper:
`lib/clans.js` (`new Clans(client)`), live proof: `clans-lifecycle.js`.

## Facts

- **No gating**: a fresh level-1 guest can create a clan. Costs nothing.
- `shortName` ≤ **5 chars** (error: "Short name must be 5 or fewer characters"); `longName`
  must be **globally unique** ("Clan with the long name … already exists") — beware orphaned
  test clans.
- clan ids are UUIDs; player identity in clan payloads is the hex **gid** (same as crews).
- Join flow: `requestToJoinClanId` → requester gets Event "Request sent / You will be added
  if they approve"; owner `getRequestsToJoinClanId` → `requestsToJoin[{username,gid,level}]`;
  `acceptGidJoining` → `{clearRequestsToJoin:true}`. (No crew-style "not accepting" gate.)
- Management acks are **invalidation flags**: promote/kick/removeAdmin → `{clanMembersStale:true}`
  — re-fetch `getClanMembersForClan {clanId, sortedBy, page}` (sort: admin=3, username=4
  observed; page 0 = first ~100). Accept → `{clearRequestsToJoin:true}`. Chat post → returns
  the full `{clanChatMessages:[…]}` immediately. announce → `{announcementCreated:true}`.
  leave/dismiss → `{clearMyClanInfo:true}`.
- `minLevel`: **silent verb AND did not persist** (set 5, myInfo still reported 1) — needs the
  `shortName/longName/description` edit combo or is admin-only-elsewhere. Open question.
- `listClans` is capped at exactly 100 rows, no paging field — `listClansFilter` narrows it.
- `leaderboardType/Days` → real global `WallOfFameDetails` rows (observed: level-72 player
  "zpazz" of clan PLTR, 129k score).
- `ClanInfo.requestedToJoin/isMember` tell clients button state; `MyClanInfoResponse` carries
  `amIAdmin/amIOwner/minLevel/points/lastRead*`.

## Fleet recipe (tested)

```js
import { listServers, register } from "./index.js";
import { makeBot, recoverBot, loadAccounts } from "./clans.js";
const owner  = await makeBot("owner", server);            // persists account to fleet-accounts.json
const clanId = (await owner.clan.myInfo()).myClanInfo?.clanId ?? (await owner.clan.create("MYTAG","My Long Name","desc")) …
const r = await joiner.clan.join(clanId);
const inbox = await owner.clan.joinRequests(clanId);
for (const q of inbox.requestsToJoin ?? []) await owner.clan.accept(q.gid);
```

`makeBot(..., {persist:true})` registers an email+password account (free, unverified) and
appends to `fleet-accounts.json`; `recoverBot(email,pw,server)` logs back in from ANY session —
automation that dies mid-clan never orphans its state again (see caveat below).

## Caveat — known orphan

`clans-lifecycle.js`'s first crashed run (pre-persistence) left one live orphan on Server 5:
short `CLWXN`, long name "Claw Testing Fleet", 3 offline guest members, score 0, unmanageable
(owner session id lost). Disclosed deliberately; it should age out or can be reported to the
devs as test residue. Later runs dismiss their clans in-script.
