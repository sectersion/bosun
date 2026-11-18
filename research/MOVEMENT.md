# Movement model — derived from live capture 2026-11-18

Source: `capture-1.jsonl` (4.65 min, user `not_a_human`, Server 1, 14,638 decoded frames,
both directions; handshake key captured passively from the page's own socket).
`decoded-session.jsonl` = first replay fixture for world-model tests.

## The model (supersedes the inferred one in architecture.md)

Movement is **client-declared, server-trusted within a speed envelope**:

1. Uplink `MyTankMessage` flows at **~13/s** (not exactly 10; render-loop driven), each one a
   **diff vs the previously sent state** — unchanged fields are simply absent (so `relativeToId`
   etc. appear only on the tick they change; consumers must carry last-seen values).
2. `x/y/z` claims are accepted and re-echoed in WorldMessage with **residual ≈ 0.15–0.3
   world units, echo lag ~0 ms**. The server does NOT re-simulate position; it relays.
3. **Legit speeds** (world-frame, mixed foot+ship): median 2.6, p90 4.4, max 11 u/s.
   Observed on-deck walking earlier ≈ 3.6–4.3 u/s; sailing varies 2.6→11 with wind/turns.
   Our sail.js failure sent **+30 u/s** — 3–10× outside the envelope → re-anchor. The
   mechanism was never denied; the magnitude was.
4. When aboard, claims are **ship-relative** with `relativeToId=<ship actor id>`; the ship
   itself is a world-frame actor whose own claims (by its helmsman, or the server?) move it.
5. `interpolationIndex` uplink is a small **cycling 1..5 counter** (5-slot snapshot buffer),
   NOT the world snapshot index as previously guessed; stays at 1 while stationary.
6. Respawn: `RequestRespawnMessage {location:2}` (your ship) used 5×, `location:1` port.

## Combat correction — hits are client-declared

`CSCollision` (type 46, uplink) carries `{cannonBallId, tankHitId, relativePosition,
worldPosition}`: **the shooter raycasts in its own Jolt world and reports the hit**; the
server validates (tolerance unknown) and broadcasts `HitMessage`/`TankDamageMessage`.
36 `MyFiringMessage` → 7 CSCollision (one ball can hit multiple? or only clean hits reported).
Firing origin `x/y/z` is ship-relative with `relativeToId` set; `id` is a random client-chosen
52-bit projectile id echoed by `RemoveCannonBall`.

## Chat & misc confirmed in the wild
- `ChatMessage` downlink streams freely (world chat readable without any account rights).
- `animationState` values observed: 5,6,7,8,9,10,11,17,20,22,23 (11↔17 toggles idle↔walk;
  ship states include 7; sail-work likely 20/22/23 — unlabeled).
- Full decode pipeline: `analyze.mjs` (timeline) + `aggregate.mjs` (stats); collector `collect.js`.

## VALIDATED 2026-11-18 — walk engine live (`lib/movement.js`, proof: `research/walk-live.js`)

**The bare claim was the whole bug.** `MyTankMessage` claims must ALWAYS carry the
coordinate-frame declaration — a bare `{id,x,y,z}` is silently discarded into the void
(not rubber-banded, not answered):

```
relativeToId: 2^48-1 (WORLD) | relativeToVehicleId: 2^48-1 | vehiclePositionIndex: 0
interactingWithIndex: -1 | interactionVector: {} | interpolationIndex: 1..5 cycling
animationState: 11 = standing, 17 = walking | rotationY = heading | antiAfk bit
```

Result: 15u walked at 3.6 u/s, 47 claims, **0 corrections** — server relays every step.
Server-observed travel lags claims slightly (13.3 vs 15.0) = echo smoothing/interest, not rejection.
Observed curiosity: server re-sent `ResetYourState` (spawn event) right at arrival — cadence
of those is unexplained (periodic re-anchor? idle-timeout related?); harmless, worth watching.

## SAILING SOLVED 2026-11-18 (guided capture #2, session-2 forensics)

**Propulsion = an interact, not a command field.** On the sloop (tankType 1):

1. Stand at deck **(0.4, 4.1, -5.5)** (mast, ship-relative coords)
2. Claim with **`interactingWithIndex: 0, interactableActorId: <shipId>, animationState: 22`**
   — tap-hold F; `interactionVector` stays empty (a toggle, not a rope-pull)
3. ~3 s later (sail-drop animation) the hull accelerates along its `rotationY` at
   ~1.1–3.5 u/s; helming = camera yaw, rider `animationState: 7`, `vehiclePositionIndex: 0` = helm seat
4. `interactingWithIndex: 3` + rising `interactionVector.y` (→0.79) = **anchor windlass**
   (sustained pull) — not required to get moving; `ii=1` = other mast interactable
5. The rider never writes the ship's world coords — server physics carries the hull from
   yaw + sails. Bundle: `interactWithShipOrIslandThing()` (F-key + nearest interactable).

Live proof: `sail-live.js` bot **sailed 143u of a 150u order** (429 claims, arrived in
radius); `bot.sailTo()` auto-lowers sails; trail in `sail-trail.svg`.

## Still to determine
- [ ] Unmanned-ship behavior (drift? stop?), multi-seat ships (cannon crew seats)
- [ ] Hull taxonomy: sail/deck positions for larger tankTypes (15+)
- [ ] CSCollision validation tolerance (research-only — do not probe maliciously)
- [ ] Mystery periodic `ResetYourState` re-anchors mid-idle (every ~2 min?)
