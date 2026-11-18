# Items & player-interaction mechanics — findings 2026-11-18

## The actor taxonomy (recovered from bundle enum `zB`)
`TankMessage.tankType`: Soldier 0 · Sloop 1 · Horse 2 · FieldCannon 3 · StaticActor 4 ·
WarShip 5 · Clipper 6 · SharkNpc 7 · FishNpc 8 · **ItemActor 9** · FishingHook 10 · Cutter 11 ·
RowingBoat 12 · Raft 13 · SmallRowingBoat 14 · FirstRate 15 · FlyingDutchman 16 · Frigate 17+
→ exported as `TANK_TYPE`/`SHIP_TYPES` in `lib/world.js`; `world.items()` / `world.ships()` queries.
(Client logs `unsupported tankType` for classes it doesn't construct — the list continues past 17.)

Weapon ids (`heldWeapon`, `weaponType`): Fists 0 · Pistol 1 · Musket 2 · HandCannon 3 ·
**Sabre 4** · ShipCannon 5 (+GrapeShot 6) · FieldCannon 7 (+Grape 8) · HorseMelee 9 · SharkBite 10.

## Verified live ✅
- **Item/weapon switching**: set `heldWeapon: N` in any `MyTankMessage` claim → server echoes
  it back on the actor. Works standing/still; no dedicated message needed. `bot` users: just
  claim the field (test: `research/items-live.js` step 1).
- **Pickup + drop** (`research/pickup-live.js`): `PickUpItemMessage{actorId}` **works once you
  are within ~1u** — walked a bot to 0.7u, sent it, and the server set `carriedItemId=<itemId>`
  (via a `ResetYourState.yourTank`). `DropItemMessage{foo:true,x,y,z}` clears it back to the
  `2^48-1` sentinel (= "carrying nothing"). The earlier "unreachable success path" was purely a
  movement prerequisite: distance is validated ("too far away" at 13.5m), and the bot only
  passes once `walkTo` gets it adjacent. **`carriedItemId === WORLD sentinel` ⇔ empty hands.**

## Mechanism identified, server acceptance NOT reproduced ⚠️
- **Pickup**: dedicated `PickUpItemMessage{actorId}` (type 66) — NOT an F-interact claim
  (`interactWithItem()` in bundle sends this message directly, gated client-side by
  proximity + `gameClient.items[]` registry). Sent to a `tankType:9` ItemActor ~0–9u away:
  **no echo, no bag change.** Remaining hypotheses: strict proximity (~<2u) + facing, item
  eligibility by `itemType` (tested type=4 props), or server wants the interaction-claim
  preamble the real client's key handler emits alongside.
- **Melee**: `MyMeleeAttack(42)` = **client-declared hit** like cannons — fields are
  *target-local*: `relativeX/Y/Z` = hit point in target frame (≈ body center), `relativeDirectionX/Y/Z`
  = normalized attack ray rotated by the target's **inverse quaternion**; gated by wall
  line-of-sight (`isLineBlockedByWalls`). Two coordinate-model attempts produced zero
  `TankDamageMessage`/`HitMeFromMessage` on the target. Suspect melee requires matching
  attack-windup animationState timing (the client animates the swing and probably can only
  fire at specific frames) or a server-side cooldown tied to real attack input.

## Player↔player surface (protocol view)
chat global/group ✔ (registered) · crew invite/join ✔ · friends ✔ · DM ⛔ gated · spectate ⛔ gated ·
**no P2P trade exists** — "trade" = selling cargo to `NpcTrader` (classification 6) via
`BuyCannonballs`/shop family. Damage between players flows exclusively through
client-declared cannons (`MyFiring`→`CSCollision`) and melee (above).
