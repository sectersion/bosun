# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Unofficial reverse-engineered API access to **Salty Seas** (saltyseas.io), a live multiplayer 3D naval game. Two goals: (1) document the API in `docs/`, (2) keep `lib/` an easy Node SDK to build custom clients on. There is no official API and no published ToS. `docs/coverage.md` is the authoritative per-type/per-endpoint status matrix — every row is backed by a reproducible probe.

## Commands

All runnable scripts live in `lib/` (Node ≥22 ESM, deps `protobufjs` + `lz4js`):

```bash
cd lib && npm install
node demo.js                 # register a guest, print profile
node demo.js --probe         # + connect, handshake, decode live ticks
node group.js 5 --prefix Kraken --link "<invite url>"   # fleet crew-grouping
node clans-lifecycle.js      # full clan create→join→manage→dismiss probe (cleans up)
node friends-lifecycle.js    # friend request/accept/block/remove lifecycle
node sail.js                 # movement-authority experiment (superseded: see research/MOVEMENT.md)
node fleet-cost.js 6         # per-bot bandwidth/RAM/CPU measurement
node test-world.js           # OFFLINE: WorldModel unit + recorded-fixture replay (no server)
node world.js / bot.js       # the high-level layer: WorldModel (state) + Bot (socket+verbs)
node probes/<domain>.js      # per-domain coverage probes
```

No build/lint/test suite — the live probes ARE the tests; run them to validate protocol changes. **`lib/test-world.js` is the exception: a fully offline unit+replay test (no server) that gates the WorldModel merge semantics against `lib/fixtures/session-90s.jsonl` — run it after any protocol-layer change before touching live servers.**

## High-level layer (mineflayer core)

- `lib/world.js` `WorldModel` — socket-free, evented actor registry. `apply(name,msg)` merges full-state snapshots / optional-field deltas / `actorsToRemove` despawns (null=clear, absent=unchanged) and emits `spawn/tick/actorAppear/actorMoved/actorGone/chat/event/explosion/damage/scores/crew`. Queries: `humans()/islands()/vessels()/traders()/nearestFrom()/positionOf()` (resolves vehicle-relative chain; ignores parent rotation — see ponytail note).
- `lib/bot.js` `Bot`/`createBot` — WorldModel wired to a live `GameClient`, plus first verbs (`spawn`, `chat`). This is the layer users build on; probes/scripts below it use raw `GameClient`.
- Movement is intentionally NOT in this layer yet (next milestone). `research/MOVEMENT.md` has the cracked model (client-declared positions at walk speed ~4 u/s are trusted; our old 30 u/s was why it failed).

## Critical context

**These hit LIVE PRODUCTION game servers.** Etiquette is load-bearing:
- Least-populated of servers 3/4/5; Server 1 is usually full. Every script self-closes in <60s.
- Rejections/timeouts are findings — print them, never retry-loop the server.
- `makeBot()` persists recoverable email+password accounts to `lib/fleet-accounts.json` (gitignored — NEVER commit it); `recoverBot()` re-logs from any session. Scripts that die mid-state orphan live game state (there is one disclosed orphan clan on Server 5 from before persistence existed).

**Protocol facts that require cross-file reading to appreciate:**
- Uplink = `[u8 msgTypeId][protobuf]` cyclic-XOR'd with a 256-byte per-session `protocolKey` from the handshake; downlink = same payload wrapped in an **lz4js** frame. lz4js's block-size high-bit means "stored" — inverted vs the real LZ4 spec; both ends of the game use lz4js, so `lz4.js` must keep wrapping *lz4js*, not a spec decoder.
- Schemas: `docs/game.proto` (122 messages, extracted from the game's bundle — do not hand-edit; re-extract on new bundle versions; published copy has original comments stripped). protobufjs here maps **camelCase only** — snake_case keys encode to nothing, silently.
- `clientVersion` (currently `1158`) is baked into `lib/index.js`; it breaks on every game redeploy (`DisconnectReason{reason:7}`). Refresh: grep the current `938.*.js` chunk at `https://cdn.saltyseas.io/app/` for `L=<number>` near `DV:()=>L`.
- Movement is NOT position-claim: `MyTankMessage` is diff-based, aboard positions are vehicle-relative, the server integrates heading/animation. World-coordinate claims get rubber-banded for everyone. See `docs/architecture.md` before "fixing" this.
- Error/validation responses arrive as `EventMessage` (type 2), and many verbs ack with invalidation flags (`clanMembersStale`, `friendRequestsStale`, `clearRequestsToJoin`) or nothing at all (silent-ack). A missing reply is NOT failure — verify by re-reading state (`myInfo`, `list`, `roster`).
- `FriendsRequest`/`ClanRequest` are Swiss-army messages: set EXACTLY ONE verb field per request. `addFriendGid` is symmetric (request to stranger / accept to requester); `blockGid` silently deletes the friendship.
- Guest identity: `register()` creates a guest; `registerAccount(id, email, pw)` binds a recoverable account (no verification, no email-format check, pw ≥6). `<name>@salty.invalid` addresses are the convention.

**Coverage discipline:** any `coverage.md` status must reflect an *observed* server response. `exercised` = actual reply; silence = `not-exercised`; explicit refusal = `exercised-with-rejection` with the verbatim message. (A 19-agent coverage run showed unverified self-reports over-claim ~60% of the time — hold single-agent edits to the same bar.)
