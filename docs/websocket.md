# WebSocket game protocol

## Connection

```
wss://api-eu-1.saltyseas.io/saltyseas-game/server-<N>?id=<userId>
```

`websocketHost` comes from `GET /api/list-servers/`; the client appends the id query
(`new WebSocket(\`${websocketHost}${i}\`)`). `binaryType = "arraybuffer"` — all traffic is binary.

## Framing

**Downlink (server → client):** every WS message is a standard **LZ4 frame**
(magic `04 22 4D 18` little-endian). After decompressing:

```
[u8 messageType][protobuf payload of that message]
```

**Uplink (client → server):** `[u8 messageType][protobuf payload]` **XOR-masked** with a
256-byte session key (`ob = (b,k) => b.map((x,i) => x ^ k[i % k.length])`), no LZ4 observed.

## Handshake

The first downlink frame, after decompression, is 264 bytes:

```
[8 magic bytes: 0D 0E 0A 0D 0B 0E 0E 0F][256-byte protocolKey]
```

The client validates the magic, keeps the key for all subsequent uplink frames, then:

1. sends `InitMessage { id, client_version, is_crazygames }` (id = `me.id`)
2. after ~1.24 s sends `LazyLoaderMessage (24) { id: <fingerprint> }` (FingerprintJS visitor id, likely)
3. flushes anything it buffered while disconnected

Every disconnect closes with a `DisconnectReason (1)` frame first (ban / kick / reconnect codes).

## Message types (server↔client, u8 id)

Full 69-entry table: [`msgtypes.json`](msgtypes.json) · payload schemas: [`game.proto`](game.proto)

| id | message | | id | message |
|---|---|---|---|---|
| 1 | DisconnectReason | | 19 | ServerConstantsMessage |
| 2 | ResetYourState | | 21 | EventMessage |
| 3 | **WorldMessage** (tick) | | 22 | HitMessage |
| 4 | TestingMessage | | 23 | HitMeFromMessage |
| 5 | MyTankMessage (input/state, ↑) | | 24 | LazyLoaderMessage |
| 6 | RequestFullState | | 26 | RequestRespawnMessage |
| 7 | MyChatMessage (↑) | | 32 | ScoresMessage |
| 8 | ChatMessage | | 47/48/49 | EquippedItems / Get / Update |
| 9 | MyFiringMessage (↑) | | 54 | MyGroupMessage |
| 10 | CannonBallMessage | | 57/58 | SelectSkin / SkinSelected |
| 15 | GlobalExplosion | | 61–64 | Medals |
| 20 | TankDamageMessage | | 79/80 | SelectShip / ShipSelected |

The tick loop: client sends its state (`MyTankMessage`) ~every frame; server replies
`WorldMessage` with authoritative actor positions (`isFullState` on join / after
`RequestFullState (6)`, otherwise deltas). `ServerConstantsMessage` carries round length etc.

## Observed traffic sample (guest on server 1, 2026-11-16)

Handshake → Init → ServerConstants(19) → EventMessage(21, respawn notice) → WorldMessage(3)
ticks ~130–180 B each at ~5–10 Hz, with periodic scores and chat. First recorded tick
hex-prefix (after LZ4 strip): `40 60 82 ... 03 88 c5 e4 b9 01 1a 23 ...` — type byte `03` ✓.

## Probe-verified server behavior (2026-11-17, guest probes — see coverage.md)

- **Movement is NOT position-claim relay.** A freshly-respawned guest's `MyTankMessage(5)`
  x/y/z claims are never applied: the server re-anchors every tick with
  `ResetYourState(2)` (`forcePosition=false`, `heldBy.holderId=281474976710655` = 2^48−1
  null sentinel — not an attach-lock). +1-unit and +300-unit jumps react identically; no
  `suspectedHacking(9)`, no disconnect. `interpolationIndex` pairs with the per-actor
  snapshot counter (frozen at 1 while inert), not the global tick index. The actor is
  listed in `WorldMessage` only inside `isFullState` snapshots until its state actually
  changes. Accepted locomotion channel (velocity-continuous Jolt state? real ship spawn?)
  is the open question gating movement/items/PvP-out-of-safe-zone coverage.
- **Tick stream**: `WorldMessage(3)` at 10.0 Hz; `index` = global uint64 (~3.09M, +1/tick);
  `is_low_frequency` is deterministic period-4 (~25%, load-independent on an 8-player server);
  delta ticks exclude unchanged actors (`diffTankMessages` confirmed live).
  `RequestFullState(6){index}` answers with a **burst of 2–4** full-state ticks; no
  server-side rate limit (the 1/s cap is client-side).
- **protobufjs camelCase gotcha**: encode `rotationY`, `interpolationIndex`,
  `clientPressedSomethingForAntiAfk` — snake_case keys are silently dropped on encode.
- **Combat chain** `9→10→29`: `MyFiringMessage.id` is the **client-chosen projectile id**
  (random 52-bit ids echoed verbatim by `RemoveCannonBall`); `firedById` is server-derived;
  broadcast velocity = normalize(dir)×weapon speed from the claimed origin. Melee type 0
  and ship-cannon type 5 fired on foot are never broadcast — silent `RemoveCannonBall` echo
  only. Port(1)/Jungle(3) spawn islands are PvP safe zones: a shot that would land on
  someone gets `EventMessage {primary:"Safe Zone", secondary:"PvP is disabled around this
  island", eventMessageType:2}` to the shooter 125–221 ms after fire; PvE (barrels) still
  takes damage.
- **EventMessage(21).eventMessageType**: 0/absent = plain info toast; 2 = error popup
  (primary=title, secondary=detail). 1/3 never observed.
- **Protocol noise is not punished**: `TestingMessage(4)`, `ModToolsRequest(40)`,
  `RequestJoinSpectators(55)`, `LeaveSpectators(65)`, dead `GetMyEquippedItems(48)` draw
  silence or a soft EventMessage — never DisconnectReason. Spectating is admin-only
  ("Spectating is for admins only", matching REST `canSpectate=false`); crew-flag planting
  is position-gated ("Stand on the deck to plant your flag"), not leadership-gated.
- **Bag/inventory**: `GetMyEquippedItems(48)` never replies (dead path) — authoritative kit
  arrives via `ResetYourState.equipment` (47) on connect/respawn; `UpdateEquippedItems(49)`'s
  echo doubles as the ack: valid reorder → new order echoed (accepted), count perturbation →
  original state echoed (silently rejected). `PickUpItemMessage(66)` range-validates
  ("Cannot pick up / It is too far away" at 13.5 m); Drop/Eat/DropBag/PullActor fail
  silently when preconditions are unmet. `FishingReelMessage(70)` on land is accepted and
  triggers a ResetYourState re-push. Ground items are world actors: `tankType=9`,
  classification Neutral(5), `itemType` 2=Beer 3=Wine 4=Rum 5=Gold 6=Gems with price in the
  username (Wine $600 / Rum $720 confirmed live). `TankMessage.carriedItemId` sentinel when
  empty = 2^48−1.
- **Ships/skins**: ships are **level-gated, not gold-priced** (Sloop 1, Cutter 2, Frigate 8,
  WarShip 14, Clipper 20, FirstRate 26; four null-`levelUnlocked` hulls are NPC-only →
  "Invalid ship"). `SelectShipMessage(79)` ALWAYS echoes `ShipSelected` — including on
  rejects (re-asserting Sloop) — so read the verdict from the EventMessage. Skin recolor
  (`selectedSkin`) is free; `characterMesh` is the gated axis ("Cannot select character:
  Level N required", then reset). Ship selection does **not** persist to REST `/me/`.
  `RequestRespawn{location:2}` with no ship silently degrades to a soldier spawn.
  Shop costs live in `cannonBallProps` (Grape 0.5, Fire/Ice/Shell 1, Galley Shiv 400@lvl2 …
  Poseidon's Trident 15100@lvl100); trader/shop sends (`76/77/78`) proximity-gate first
  ("Too far from the trader"), before any gold check.
- **ResetYourState is two-phase** on join: the first push carries `equipment` but an empty
  `yourTank`; the full snapshot appears only after `RequestRespawnMessage(26)`. Fresh
  soldier: health 10, `animationState` 11, `heldWeapon` 4, `relativeToId/relativeToVehicleId`
  = 2^48−1 sentinel, deterministic per-island spawn coords, `mapSize=1700`.
- Post-init unsolicited push sequence on connect: ServerConstants(19) → FriendGids(43){} →
  MyCrewResponse(74) → EquippedItems(47)×2 → ResetYourState(2).

## Crews / auto-grouping

Player identity everywhere in-protocol is the **gid**: a 16-hex-char account id
(`TankMessage.gid`, `OpenCrew.leader_gid`, `CrewMember.gid`, `CrewJoinRequestMessage.requester_gid`,
`CrewRequest.target_gid`). Usernames are display-only. Find someone's gid from their username via
`OpenCrewsResponse` (recruiting crews) or `WorldMessage.tanks[].{username,gid}` (everyone in the world).

Two ways for clients to group into one crew:
- **Invite token (works always, no approval)**: the leader's `MyCrewResponse.inviteToken` — also
  embedded in the game's invite links as `?saltySeasGroupId=<token>` (app reads the param on load,
  sends `MyGroupMessage{inviteToken}` once connected, and the server drops them in immediately).
- **Request/accept flow**: `CrewRequest{action=requestJoin(2), target_gid}` → leader receives
  `CrewJoinRequestMessage` → presses J in the UI → `CrewRequest{action=acceptJoin(3), target_gid=requester}`.
  Only works if the leader ticked **"accept requests" in the Join a Crew menu** (server-side flag —
  otherwise `EventMessage "That crew is not accepting requests"`; NOT related to ship ownership as
  first suspected). Actions: getOpenCrews 0, getMyCrew 1, requestJoin 2, acceptJoin 3, leave 4,
  transfer 5, kick 6. `OpenCrewsResponse` lists only recruiting crews.

Probe-verified crew details (2026-11-17, rerun ✓):
- The `invite_token` is **group-derived, leader-independent** (salted 64-bit hash of
  `group_id`, 16 hex): it persists unchanged across a leadership transfer, and only the
  CURRENT leader's `MyCrewResponse` push carries it (members' pushes have it empty —
  non-leaders can't read the token back).
- Crews/tokens are **session-scoped**: every leader login regenerates `group_id` + token and
  drops members. The 24 h `saltySeasTime` window on invite links is enforced CLIENT-side
  only; server-side "Invite link expired / That crew no longer exists" actually means no
  live crew matches the hash (a stale-but-real token gets the identical message).
- `transfer(5)` **strips the old leader's authority**: their subsequent `kick(6)`/`transfer`
  are rejected `EventMessage "Cannot remove / Only the crew leader can do that"`.
  Per-recipient transfer Events: old leader "Leadership given to X", new leader "You are
  now the crew leader", others "X is now the crew leader". Join broadcasts "X joined your
  crew" to members, "Joined the crew" to the joiner.
- **Leader leave(4)**: the leader departs into a BRAND-NEW solo crew (new group_id+token,
  respawned); survivors keep the ORIGINAL group_id and leadership auto-succeeds — rule
  indeterminate from one run (later joiner C beat founder A; needs a 4th member to pin).
- `PlaceGroupFlagMessage(71)` gate is standing on the ship's deck (position), not leadership.

## Reconnect & resilience (library policy, 2026-11-18)

Every new TCP connection is a **new handshake**: the downlink magic frame carries a fresh
256-byte protocolKey, so any reconnect must re-handshake and re-XOR with the new key before
sending anything (proven in `research/reconnect-live.js`). Library policy in `GameClient`:
- Any socket close → exponential backoff reconnect (cap 30s) — unless flagged intentional
- `DisconnectReason` codes steer policy: never reconnect on 0/2/9/10/14 (another tab, bans,
  suspected hacking, kick, main-server ban); code **7 (oldClientVersion) triggers
  `currentVersion()` re-scrape** (app.html → main.js chunk map → `938.*.js` → `L=`) and
  reconnects with the new build number — version drift self-heals
- After re-handshake, the server replays ServerConstants + full state (world resyncs itself);
  `Bot` auto-re-enters the world (respawn 2 if a sail was in progress, else last spawn point)
  and in-flight `walkTo`/`sailTo` loops skip ticks while down, then resume

## Open items

- ~~Decode a full WorldMessage tick~~ done (probes decode all live types);
  ~~InitMessage numeric type id~~ = 0 (`Init`).
- Find the accepted locomotion input channel (what gets a fresh actor out of the inert
  spawn snapshot: velocity-continuous state? animation? actual ship spawn?) — unblocks
  movement relay, item pickup success, PvP outside safe zones.
- Death chain (`22/23/27/30`), bots (`25`), trader purchase success (`78` with paid ammo
  in reach), registered-account chat, `CSCollision(46)`, `ScoresMessage(32)` live re-decode.
- Verify uplink frames carry no LZ4 wrapper at server side (client code doesn't compress).
