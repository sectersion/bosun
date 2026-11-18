# API Coverage Matrix

Generated 2026-11-17 from `probes/*.js` (salty-seas-lib guest-account probes) plus the
2026-11-16 DevTools capture and the main-session crew verification. Every implementer claim
was adversarially re-run; **where the rerun contradicted the claim, this matrix takes the
rerun's view.** Rubric: `exercised` = a server response was actually observed; **silence is
not exercise** (a send that drew no frame is `not-exercised`); `exercised-with-rejection` =
server responded with an explicit refusal; `blocked` = a known prerequisite (PvP safe zone,
movement relay, death, bots, UI-only flag) prevented the success path.

Domain verdicts (verified-by-rerun): **crews, config, rest-misc ✓** · movement, combat,
items, cosmetics, social, spectators ✗ — statuses corrected below; core server behaviors
still reproduced in the reruns (details in Per-domain caveats).

## WebSocket message types (69)

Dir: ↑ sent by client · ↓ received from server.

| id | Message | Dir | Domain | Status | Mechanism / evidence note |
|---|---|---|---|---|---|
| 0 | Init | ↑ | handshake | exercised | `{id, client_version:1158, is_crazygames}` accepted pre-handshake (key frame precedes it). |
| 1 | DisconnectReason | ↓ | policing | not-exercised | Never fired in any probe (no kick/ban); documented earlier from browser close codes only. |
| 2 | ResetYourState | ↓ | movement/config | exercised | Two-phase on respawn: first push equipment-only, `yourTank` appears only after respawn; rubber-band carries `forcePosition=false`, `heldBy.holderId=281474976710655` (2^48−1 = null sentinel, so NOT an attach-lock). |
| 3 | WorldMessage | ↓ | movement/config | exercised | 10.0 Hz ticks; `index` global uint64 (~3.09M, +1/tick); `is_low_frequency` deterministic period-4 (~25%); delta ticks exclude unchanged actors — own tank appears only inside `isFullState` bursts. |
| 4 | TestingMessage | ↑ | spectators | not-exercised | Dummy sphere sent; zero frames returned — dev-only, server ignores, no reply type exists. |
| 5 | MyTankMessage | ↑ | movement | exercised-with-rejection | Fresh-respawned guest: every position claim discarded + re-anchored to spawn, actor `interpolationIndex` frozen at 1; identical reaction to +1 and +300 unit jumps. Rerun correction: only jumps 120/300 and sail steps +1/+3 actually issued (claim overstated magnitudes). |
| 6 | RequestFullState | ↑ | config | exercised | `{index:<own latest>}` → burst of 2–4 consecutive `isFullState=true` ticks; stale `{index:1}` also answered; no server-side rate limit (client self-limits 1/s). `{index:0}` drew nothing (items probe). |
| 7 | MyChatMessage | ↑ | social | exercised-with-rejection | Guest text never relayed; server answers ChatMessage "Login / Register to use chat" (global and group alike). |
| 8 | ChatMessage | ↓ | social | exercised | Observed as the system gate notice `{username:'Server', message:'Login / Register to use chat', messageType:1}`; real player relay needs a registered account. |
| 9 | MyFiringMessage | ↑ | combat | exercised | Ranged shots accepted, projectile echoed by id. Rerun correction: degenerate inputs (zero dir, reused/negative ids, sub-interval cadence) NOT in committed probe — that sub-claim is carried, not re-verified. |
| 10 | CannonBallMessage | ↓ | combat | exercised | Own shots broadcast with `x/y/z` = claimed origin, `id` = client-chosen projectile id, `firedById` server-set. Rerun correction: guests co-located → all velocities (200,0,0); the cited non-trivial normalize(dir)×speed evidence came from a different configuration; ambient broadcasts = 0 this run. |
| 15 | GlobalExplosion | ↓ | combat | blocked | Ambient-only (impact VFX); ZERO received in verification run — claimed type-1/6/7/absent semantics unreproducible from probe. |
| 19 | ServerConstantsMessage | ↓ | config/cosmetics | exercised | Full decode live: 10 ships w/ `levelUnlocked`, 36 `cannonBallProps` (price table), 19 `characterMeshUnlocks`; NO roundLength/playerTimeout/mapSize fields (docs line corrected). |
| 20 | TankDamageMessage | ↓ | combat | blocked | Ambient-only (barrels/terrain); ZERO in verification run — claimed 12+ payloads, barrel ids, radius/2^48−1-sentinel semantics unreproducible from committed probe. |
| 21 | EventMessage | ↓ | combat/items/spectators | exercised | `eventMessageType`: absent/0 = info toast; 2 = error (primary+secondary). Observed: respawn notice, Safe Zone, Cannot pick up, trader distance, ship/skin/crew gates. Rerun: Safe Zone latency 125–221ms (claim "~170–230" overstates floor). |
| 22 | HitMessage | ↓ | combat | blocked | PvP safe zone at Port(1) and Jungle(3) spawns nullifies hits; needs movement out of island radius. |
| 23 | HitMeFromMessage | ↓ | combat | blocked | Never received — bots never damaged in safe zones. |
| 24 | LazyLoaderMessage | ↑ | handshake | exercised | Sent post-handshake with fingerprint id; connection proceeds. |
| 25 | AllBotPositionsAndDestinations | ↓ | movement | blocked | Never arrived — `botCount:0` in config, no bots on servers 3/5. |
| 26 | RequestRespawnMessage | ↑ | combat/cosmetics | exercised | loc 3 jungle re-verified (deterministic coords); port loc 1 carried from earlier sessions. `location:2 yourShip` with no ship owned = SILENT degradation to soldier spawn — effectively exercised-with-rejection; the "aboard ship" outcome never happens. |
| 27 | ShowRespawnDialogueMessage | ↓ | combat | blocked | Requires death; safe zones prevent it. |
| 29 | RemoveCannonBall | ↓ | combat | exercised | Global; server echoes OUR chosen projectile id — proves MyFiringMessage.id is the projectile id, not shooter id. Melee/invalid-context shots = silent kill (removal only, no broadcast). |
| 30 | GibMessage | ↓ | combat | blocked | No deaths occurred (safe zone). |
| 32 | ScoresMessage | ↓ | config | exercised | Received in the original browser capture ("periodic scores"); not actively re-decoded by probes — weakest EX row. |
| 34 | ClanMiscResponse | ↓ | clans | **exercised (full lifecycle)** | All read/manage verbs answered; management ops ack via `{clanMembersStale:true}` invalidation flag; see [clans.md](clans.md). |
| 35 | ClanRequest | ↑ | clans | **exercised (full lifecycle)** | create/join/accept/promote/kick/chat/announce/leaderboard/dismiss all reproduced live by `clans-lifecycle.js`; `minLevel` write silent AND didn't persist (open). |
| 36 | FriendsRequest | ↑ | friends | **exercised (full lifecycle)** | 11 of 14 verbs verified live (add=request/accept-symmetric, reject, remove, list, requests(page), userInfo, block/unblock/blocked, playersInServer, notifications); DM verbs send but never get any response — see [friends.md](friends.md). |
| 37 | FriendsResponse | ↓ | friends | **exercised (partial)** | payloads + invalidation-flag acks (`friendRequestsStale` etc.) verified; live push to request recipient confirmed; `conversation`/`friendsWithMessages` never populated (DMs blocked). |
| 38 | GetFriendAndClanMemberPositions | ↑ | friends | exercised | `{gimme:true}` → 39; via `friends.js positions()`. |
| 39 | FriendAndClanMembersMapPositions | ↓ | friends | exercised | Replied `{}` — empty `positions[]`, no `group_ship` for solo guest. |
| 40 | ModToolsRequest | ↑ | spectators | not-exercised | `{}` sent; zero frames — silently ignored, no response type exists. |
| 41 | RequestStuckRespawn | ↑ | — | not-exercised | Never sent by any probe. |
| 42 | MyMeleeAttack | ↑ | combat | not-exercised | Never sent by any probe. |
| 43 | FriendGids | ↓ | config | exercised | Pushed `{}` on every connect, unsolicited (part of post-init state push). |
| 46 | CSCollision | ↓ | — | not-exercised | Never observed in any session. |
| 47 | EquippedItems | ↓ | items/cosmetics | exercised | Pushed on connect (×2) + inside ResetYourState; fresh kit decoded: bag 10×`{weaponType:-1}`, held Sabre(4)/Musket(2)/Pistol(1)/FishingRod(12)/DeadFish/CrewFlag(15), cannonballs ShipCannon(5)×1 + Fire/Ice/Shell/Grape ×0. |
| 48 | GetMyEquippedItems | ↑ | items/cosmetics | not-exercised | 3–4 sends, 0 replies — dead code path; kit readable via ResetYourState.equipment instead. |
| 49 | UpdateEquippedItems | ↑ | items | exercised | Always answered with EquippedItems echo = ack: valid reorder → new order (accepted); count perturbation → original state (rejected silently). Only working bag read/write pair. |
| 51 | PlaySoundMessage | ↓ | combat | exercised | Arrived with own-shot kill/ricochet sounds (soundType 7) in rerun; ambient soundType-10 claim unverified. |
| 54 | MyGroupMessage | ↑ | crews/config | exercised | Live `inviteToken` → instant join, no approval; forged/stale token → EventMessage "Invite link expired / That crew no longer exists" (token is hash of group id, session-scoped, no server timestamp). |
| 55 | RequestJoinSpectators | ↑ | spectators | exercised-with-rejection | "Cannot join spectators / Spectating is for admins only" (type 2); REST `canSpectate=false` enforced server-side on socket. |
| 56 | PullActorMessage | ↑ | items | not-exercised | Distant target sent; zero frames (silently ignored — contrast pickup's explicit range Event). |
| 57 | SelectSkinMessage | ↑ | cosmetics | exercised | skin 0/1/3 accepted (SkinSelected + ResetYourState re-push); `characterMesh` gated per `characterMeshUnlocks` ("Level 53 required" for mesh 6, then reset to 0/0). |
| 58 | SkinSelectedMessage | ↓ | cosmetics | exercised | Echo on accept; on mesh-reject it resets selection. |
| 59 | FlushStatsMessage | ↑ | social | not-exercised | Sent, no ack frame (fire-and-forget — but unproven that it does anything). |
| 61 | GetMedalsRequest | ↑ | social | exercised | `{foo:true}` answered. |
| 62 | MedalsResponse | ↓ | social | exercised | Replied `{}` (no medals, fresh guest). |
| 63 | GetPlayerMedalsRequest | ↑ | social | exercised | gid round-trip answered. |
| 64 | PlayerMedalsResponse | ↓ | social | exercised | Echoed `{gid, username}`; `medals[]` omitted (zero). |
| 65 | LeaveSpectators | ↑ | spectators | not-exercised | `{foo:true}` sent; 0 frames (world ticks kept flowing, so not a disconnect). |
| 66 | PickUpItemMessage | ↑ | items | exercised-with-rejection | Distance validated: "Cannot pick up / It is too far away" at 13.5 m vs in-world item actor; success path unreachable without movement relay. |
| 67 | DropItemMessage | ↑ | items | not-exercised | Silently ignored while carrying nothing (no Event, no reply). |
| 68 | EatItemMessage | ↑ | items | not-exercised | weaponType 3 with empty bag → zero frames; success path unreached. |
| 69 | DropBagItemMessage | ↑ | items | not-exercised | Empty bag → zero frames, no validation error. |
| 70 | FishingReelMessage | ↑ | items | exercised | `{reeling:true}` on land → full ResetYourState re-push 1/1 in rerun (cancel path not re-verified); no cast/hook actor state machine visible from land. |
| 71 | PlaceGroupFlagMessage | ↑ | spectators | exercised-with-rejection | "Crew Flag / Stand on the deck to plant your flag" — gate is POSITION (ship deck), not leadership; proven leader on foot still rejected. |
| 72 | CrewRequest | ↑ | crews | exercised | Verified ✓: requestJoin (2) rejected unless leader ticked accept-requests; transfer (5) by leader honored, by member rejected; leave (4) → leader gets NEW solo crew, survivors keep group_id with auto-succession (rule indeterminate: later joiner beat founder in observed run); kick (6) by non-leader rejected ("Only the crew leader can do that" — transfer strips authority). |
| 73 | OpenCrewsResponse | ↓ | crews | not-exercised | getOpenCrews(0) never sent; recruiting-crew list unexercised. |
| 74 | MyCrewResponse | ↓ | crews/config | exercised | Verified ✓: solo auto-crew on connect `{group_id, leader_gid:own gid, invite_token}`; token present ONLY in the leader's push; token survives leadership transfer (group-derived, not leader-derived). |
| 75 | CrewJoinRequestMessage | ↓ | crews | exercised | Request/accept loop verified in the main browser session (leader presses J); NOT reproducible from guest probes — accept-requests is a UI checkbox. |
| 76 | OpenCannonballShopRequest | ↑ | cosmetics | exercised-with-rejection | In-world reply `{}` (open:false) — client gates on trader proximity; pre-spawn-silent half of the claim not reproducible from committed probe. |
| 77 | CannonballShopResponse | ↓ | cosmetics | exercised | `{}` with `open` omitted = false, received in-world. |
| 78 | BuyCannonballsRequest | ↑ | cosmetics | exercised-with-rejection | "Too far from the trader" (proximity gate fires BEFORE gold check — 0-gold rejection never reached). Caveat: probe fell back to `weaponType:1` (a held weapon, not shop ammo), so a genuine paid purchase was never actually sent. |
| 79 | SelectShipMessage | ↑ | cosmetics | exercised-with-rejection | Sloop(1) accepted (ShipSelected); level-gate rejections re-confirmed for Cutter/WarShip/Clipper/FirstRate + Raft "Invalid ship". Rerun: Frigate(17), RowingBoat, SmallRowingBoat, FlyingDutchman returned ambiguous silent echoes (probe listener race) — claim of clean rejection for all 9 overstates. |
| 80 | ShipSelectedMessage | ↓ | cosmetics | exercised | ANTI-PATTERN: server echoes `ShipSelected{shipType:1}` on EVERY select, including rejections — acceptance verdict is the EventMessage, never the ack. SelectShip does NOT persist to REST /me/ (selectedShip stays null). |
| 81 | BuyHeldWeaponRequest | ↑ | economy | not-exercised | Never sent (trader proximity + gold prereqs unreachable). |
| 82 | RefillHeldWeaponsRequest | ↑ | economy | not-exercised | Never sent. |
| 83 | ItemCountMessage | ↓ | items | blocked | 0 received in 3 runs; only fires on kept-slot count change (catch/eat/fire cycle) — all such success paths prerequisite-blocked. |
| 84 | TutorialsSeenMessage | ↑ | social | not-exercised | Sent with dummy key, no ack frame (fire-and-forget — unproven). |

**WS totals: 69 types — 36 exercised · 8 exercised-with-rejection · 8 blocked · 17 not-exercised.**

## REST endpoints (22)

| Endpoint | Domain | Status | Mechanism / evidence note |
|---|---|---|---|
| GET /me/ | identity | exercised | Cookie + `?id=` create-or-get guest; full profile JSON captured repeatedly. |
| PATCH /me/ | identity | exercised | Rename only — body `{username}` ≤16 chars; silently ignores unknown fields (e.g. `config`). |
| GET /me/config/ | config | exercised | 21-key blob incl. `chosenRespawnLocation` and a config `graphicsMode` distinct from the profile field. |
| PUT /me/config/ | config | exercised | PARTIAL-MERGE: PUT `{viewTypeOffset:7}` persisted with other 20 keys intact; response = full stored blob. Library: `setConfig(id, partial)`. |
| POST /me/config/ | config | exercised-with-rejection | 405, empty body, no Allow header. |
| PATCH /me/config/ | config | exercised-with-rejection | 405 (config writes are PUT-only). |
| GET /me/key-mapping/v2/ | config | exercised | 23 keys; note field name is `backwards`, not `back`. |
| GET /me/equip/<id> | cosmetics | blocked | 404 — path-form ids are not routed at all on this deployment (identity is `?id=` query only); `?id=` variant untested. Equip state is socket-only. |
| PUT /me/flush/ | sync | exercised | 200 + full profile; docs guessed POST (405). Works on per-server `apiHost` too. |
| POST /me/seen-ad/ | economy | blocked | 404 dead route on main AND api-eu-1 hosts despite the shipped bundle calling it. |
| GET /time/ | config | exercised | 200 `{"time":"…Z"}` ISO-ms, no id needed. |
| GET /list-servers/ | discovery | exercised | 5 servers, `apiHost`/`websocketHost`, `playerCount` (probe picks least-populated of 3/4/5). |
| POST /error/ | telemetry | exercised | Open ingest: any JSON array → 200 `{"ok":true}`; GET → 405. |
| POST /signin/google/ | auth | exercised-with-rejection | 401 `{"errorMessage":"Invalid Google ID token: …"}`; alg:none rejected. Deeper iss/aud/exp chain carried from a followup run, not in saved bodies. |
| POST /signin/microsoft/ | auth | exercised-with-rejection | 400 "publisherPlayerId is required"; second chain step "signature is required" carried, not re-verified this run. |
| POST /signin/crazygames/ | auth | exercised-with-rejection | 401 "Invalid CrazyGames token". |
| POST /signout/ | auth | exercised | 200 + NEW guest profile (docs guessed GET — 405). Security: old `?id=` stays fully usable after signout — query identity NOT invalidated. |
| POST /user/login/ | auth | exercised-with-rejection | 400 `{"errorMessage":"User not found"}` (dummy creds). |
| POST /user/register/ | auth | not-exercised | Not probed — would create a real account. |
| GET/POST /user/ (bare) | auth | exercised-with-rejection | 404 — only `/user/<register|login>/?id=` is routed. |
| POST /user/reset/ | auth | blocked | 404 dead route (main + EU hosts) despite bundle calling it. |
| Xsolla payments | economy | not-exercised | `secure.xsolla.com/paystation4/` — out of scope (real money). |

**REST totals: 22 rows — 10 exercised · 7 exercised-with-rejection · 3 blocked · 2 not-exercised.**

## Grand totals (WS + REST)

| Status | Count |
|---|---|
| exercised | 46 |
| exercised-with-rejection | 15 |
| blocked | 11 |
| not-exercised | 19 |
| **Total** | **91** |

## Per-domain caveats (verifier corrections applied above)

- **movement** — ✗ verified. Core negative result stands (server discards position-only
  reports from fresh guests; no anti-cheat escalation for any jump tried). Overstated
  magnitudes (only 120/300 issued) corrected on type 5; "3 spawn points" claim named 2.
- **combat** — ✗ verified. TankDamage/GlobalExplosion demoted to blocked (ambient-only,
  zero in rerun); CannonBall velocity evidence and MyFiring degenerate-input claims are
  carried, not reproducible from the committed probe. Own-shot chain (9→10→29) solid.
- **items** — ✗ verified. Six silent sends (48,56,67,68,69) demoted to not-exercised.
  Genuine positives: pickup range validation (66), UpdateEquippedItems echo-ack (49),
  FishingReel land-reply (70), kit via 47. Item success paths gated on movement relay.
- **cosmetics** — ✗ verified. Ship-rejection list narrowed to the 5 re-confirmed types;
  location=2 respawn relabeled silent degradation; api-eu-1 equip claims and the
  purchase-with-paid-ammo path not reproducible from probe. Everything else reproduced
  byte-exact (level gates, price table, skin vs mesh axes, ShipSelected anti-pattern).
- **social** — ✗ verified. FlushStats(59) + TutorialsSeen(84) demoted to not-exercised
  (sent-only, no ack). Chat gate and all list pulls reproduced; "no paging" for clans is
  an unproven inference (exactly-100 response size).
- **spectators** — ✗ verified. LeaveSpectators/ModTools/Testing demoted to not-exercised
  (zero frames). Rejections (55, 71) and EventMessage 0/2 enum reproduced cleanly.
- **crews / config / rest-misc** — ✓ verified. rest-misc notes carry some api-eu-1/JWT
  chain details from an unsaved followup run (treated as "carried", noted above).

## How to reproduce

Probes live in `C:/Users/Oliver/lib/probes/`, one per domain:
`node probes/movement.js`, `… combat.js`, `… items.js`, `… cosmetics.js`, `… social.js`,
`… crews.js`, `… spectators.js`, `… config.js` (modes `full|rest|expired`),
`… rest-misc.js`. Each registers 1–3 fresh guest accounts, picks the least-populated of
servers 3/4/5, self-closes well inside the 60 s budget, and writes raw decoded frames to
`probes/out/` (e.g. `probes/out/rest-misc.json`). Shared lib files are never modified.
`probes/_ref/` holds the extracted bundle request shapes; `probes/movement-findings.json`
+ `movement-run.log` are the movement session artifacts.
