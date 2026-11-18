# Architecture — who does what

Model in one line: **client-simulated movement, server-authoritative consequences** —
the classic .io MMO pattern, dressed in unusually dense bandwidth engineering.
Probe caveat (2026-11-17): for a freshly-respawned client the server applies NOTHING from
`MyTankMessage` position claims (see "Client owns" below) — the relay only engages via the
real spawn/physics path, so "client-authoritative movement" holds for the shipped client,
not for synthetic position-only clients.

## Server owns

- **World truth**: round lifecycle (per the bundle debug-config: `roundLength:1500`,
  `timeBeforeFirstRound:15`, `playerTimeout:420` — *not* actually sent in
  `ServerConstantsMessage`, see rest-api.md correction), spawns, despawns
  (`WorldMessage.actors_to_remove`), scores, events, chat relay
- **Economy & meta**: gold, cannonball shop, items, clans/friends/medals/crews (REST + WS)
- **Combat resolution**: client sends only *intents* — `MyFiringMessage(9)` carries
  origin, direction, ball type, shooter id. The server spawns the ball
  (`CannonBallMessage(10)` with velocity), computes hits (`HitMessage(22)` — `headshot`,
  `nerf_factor`), assigns damage (`TankDamageMessage(20)`), and reports why you died
  (`HitMeFromMessage(23)`). A client cannot declare a hit it didn't take a shot for.
- **Delta state stream**: `WorldMessage(3)` carries `uint64 index` (monotonic sequence) and
  only changed fields — every field of `TankMessage` is `optional` because the server runs
  `diffTankMessages` before sending (dev note left in the schema: *"on change update
  isTankMessageEmpty, diffTankMessages, toTankMessage and client TankMessageFull"*)
- **Policing**: `ResetYourState(2)` on divergence (`force_position` exists in proto but was
  observed `false` in every probe re-anchor — the hard-snap path never fired), disconnect
  close codes (`BannedFromMainServers`, plus a reconnect-eligible set `h.gs`), the
  `client_pressed_something_for_anti_afk` bit in `MyTankMessage`. Position-only divergence
  earns NO `suspectedHacking(9)`/kick — a naive bot is rubber-banded, not punished.

## Client owns

- **Simulating your own tank** — runs **Jolt Physics compiled to WASM in the browser**
  (`jolt.GetPhysicsSystem`, `JoltWasmMemoryLogger`, `physics.wasm`) and reports the result
  every tick in `MyTankMessage(5)`: position, rotations, turret direction, animation
  states, vehicle/passthrough state. **Probe result (movement + combat + items domains):
  the server does NOT relay a fresh guest's reported positions at all** — every
  position-claim is answered with `ResetYourState(2)` re-anchoring the actor to its spawn
  snapshot (verified across gradual +1-unit sails and +120/+300 teleports, 3 spawn points,
  both the claimed "global tick index" and per-actor `interpolationIndex`; ~185–250 reports
  per run, zero accepted; `interpolationIndex` frozen at 1, `forcePosition=false`).
  The relay presumably engages only once the actor is in the real client-spawned,
  physics-consistent state (ship driven / velocity-continuous Jolt sim) — unconfirmed.
- **Reconciliation**: tells the server `interpolation_index` (which snapshot its reported
  position was rendered at — enables lag-compensated hit checks); buffers incoming
  snapshots and interpolates (`InterpolationVarsTick`, `lastInterpolationTimeToAchieve`,
  snap-distance tolerance). *Probe status:* with a position-only client there is no
  apply-then-correct path, so the snap-distance tolerance could not be bracketed; the
  actor-side `interpolationIndex` is per-actor (stayed 1) and is NOT the global
  `WorldMessage.index` (some hints/docs imply otherwise).
- **Resync**: on stream discontinuity → `resetMessageCounterOnWeirdness()`, then
  `RequestFullState(6){index}`, rate-limited to 1/s client-side (`time - lastRequestedFullState > 1`).
  Probe-verified: the server answers with a **burst of 2–4** consecutive `isFullState=true`
  ticks (and does not itself rate-limit back-to-back requests); full-state bursts are the
  only deltas that include an actor whose state never changed.
- **Presentation**: GLTF models (`*.glb` on CDN), procedural simplex-noise terrain, ocean
  shaders driven by `WorldMessage.shader_time` (server-sent double = shared clock), and
  *destruction rendering* — dents/decals/bone-local damage drawn from `TankDamageMessage`

## The tick loop

```
client: Jolt-simulate self ──► MyTankMessage(5) ──► server
server: validate, resolve combat, snapshot-diff ──► WorldMessage(3)[index] ──► client
client: buffer snapshot, interpolate render at (time − interpDelay)
```

Measured cadence (2026-11-17): `WorldMessage` runs at exactly **10.0 Hz** with a monotonic
global `uint64 index`; `is_low_frequency` ticks fire deterministically every 4th tick
(~25% share across 3 independent runs). The server re-anchors roughly 1:1 with each
rejected `MyTankMessage` (164 ResetYourState across 181 ticks observed during one hold).

Uplink framing (verbatim from the bundle):

```js
// sendMessage(type, msg):
const i = protobuf编码器[type].encode(msg).finish();
const n = ob(new Uint8Array([type, ...i]), protocolKey);   // [u8 type][protobuf] XOR key
socket.send(n);
// ob = (bytes, key) => bytes.map((b, i) => b ^ key[i % key.length])
```

Encoding gotcha verified live: protobufjs field mapping here is **camelCase only** —
`rotationY`, `interpolationIndex`, `clientPressedSomethingForAntiAfk` encode; snake_case
keys are silently dropped, and `toObject()` returns camelCase.

Downlink: standard **LZ4 frame** (magic `04 22 4D 18`) → decompress → `[u8 type][protobuf]`.
First frame after connect is the special 264-byte handshake (`magic + 256B protocolKey`);
client must reply `InitMessage(0)` (`{id, client_version, is_crazygames}`) then
`LazyLoaderMessage(24)` (`{id: <FingerprintJS visitor id>}`, ~1.24 s later).
`client_version` is a build constant chained through the vendors bundle (`DV = A.OX = A.lZ`
in this build) — spoof the value observed from a live client rather than chasing the chain.

## Notable engineering

1. **LZ4 per message**, even for 16-byte frames; per-message-type bandwidth accounting built in (`logBandwidth`, `incrementBandwithCounts`)
2. **256-byte rolling XOR session key** from the handshake — stateful client identity: hardcoded/replayed frames from a naïve bot die on reconnect
3. **Hand-packed skeletal animation**: `BoneRotations` = 7-byte records (bone index u8 + 3× int16 Euler at π/32768, ≈0.0055°), partial updates carrying only changed bones — custom bitpacking inside a protobuf `bytes` field (kraken alone has 40)
4. **Adaptive tick rate**: `WorldMessage.is_low_frequency` flag for degraded updates (interest
   management) — measured deterministic period-4, not load-based; `is_empty_tank_message`
   short-circuits no-op states (probe: it is a server *delta-marker* — absent from
   `MyTankMessage`, and a position-less state report is treated as divergence: one
   `ResetYourState` per send, ~100–200 ms)
5. **Scene graph over the wire**: `relative_to_id`, `held_by{holder_id, hold_point}`, `dragged_by`/`dragging`, `passenger_ids`, `original_owner` — parenting relationships are first-class protocol
6. **Single-sided collision workaround**: procedural terrain meshes have no reliable winding, so every `TankDamageMessage` ships the shot's travel vector to orient the surface normal client-side
7. **Disconnect buffering**: `bufferedMessagesToSend` queues uplink during reconnects and flushes on reopen; close-code-aware reconnect scheduling
8. **Device fingerprinting**: FingerprintJS id sent post-handshake alongside the account id — the ban-evasion layer

## Building custom clients — feasibility

| Option | Effort | Notes |
|---|---|---|
| **Run the official client from a local mirror (recommended)** | an afternoon | The bootstrap has ONE gate: `hostname.includes("saltyseas.io")` — defeated with a hosts entry `127.0.0.1 saltyseas.io.localhost`. Mirror the 6 bundle URLs + asset list from a live network capture (all unauthenticated CDN), serve + reverse-proxy `/saltyseas-game/*` locally, patch one string (baked `host:"https://saltyseas.io"` → relative). WS connects direct to `wss://api-eu-1…` (Origin check untested). Visual mods = editing your local copy of `938.37e37b79.js` / swapping GLB URLs. Frozen snapshot; re-mirror on redeploy if server starts rejecting stale `client_version`. |
| **Local HTML read-only telemetry client** | hours | WS handshake + LZ4 + protobufjs + `game.proto`. WebSocket has no CORS; `?id=` auth means no cookies needed (create a guest id once with `curl https://saltyseas.io/saltyseas-game/api/me/`). Get full world state, chat, scores, damage → tactical map, replay recorder, stat overlays. |
| Full 3D re-render in own page | weeks | Everything above, plus: fetch GLB/texture assets from `cdn.saltyseas.io/app/` (unauthenticated), reimplement terrain from the noise params, accept interpolation-only movement (no Jolt needed for read-mode rendering). Loses visual parity every time they change shaders. |
| Userscript patching the official page | days, brittle | Direct access to their scene graph, but you're patching minified code that churns with every deploy. |

Unknowns to test first (from a `file://` or `http://localhost` page):
1. Does the openresty/WS layer check `Origin`? (Probably not — test by opening the socket.)
2. Does the server reject a spoofed-but-stale `client_version` / `version:1` mismatch?
3. Multiple simultaneous sessions on the same id — use a *separate* guest id for experiments.
   (Probes always used fresh guest ids; several guests concurrently on one server works.)
4. **The accepted movement input channel** — position claims in `MyTankMessage` are discarded
   for fresh guests (verified, movement domain); a write-capable custom client must first
   reproduce it (velocity-continuity? real ship spawn?). Read-only telemetry needs none of this.

Housekeeping, stated once: as of 2026-11-16 saltyseas.io publishes **no ToS at all** (probed
terms/rules/eula → 404; only a privacy policy exists). So protocol use breaches no published
contract — but ban risk stays real (fingerprinting, ban close codes, ResetYourState are
built), and redistribution of their code/assets is still copyright-encumbered.
