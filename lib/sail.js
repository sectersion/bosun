// Sailing — the helmsman controller. VALIDATED LIVE 2026-11-18 (research/sail-live.js:
// bot lowered sails and sailed 143u of a 150u order). Full derivation: research/MOVEMENT.md.
// • aboard = claims carry relativeToId=shipId and ship-relative deck coords
// • propulsion is an INTERACT: tap-hold the mast interactable (ii=0, anim 22) at deck
//   (0.4,4.1,-5.5) on sloops → hull accelerates along its rotationY (~3s sail-drop delay)
// • helmsman camera yaw is the rudder (~0.075 rad/s turn); anchor windlass = ii+3 pull, optional
import { WORLD } from "./world.js";

const TICK_MS = 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Sloop mast interactable (captured from live user session, decoded-session-2):
// standing at deck (0.4, 4.1, -5.5), tap-hold F (interactingWithIndex 0, anim 22) →
// sails set ~3s later, hull accelerates to wind speed. Verified on tankType 1.
const SAIL_DECK = { x: 0.4, y: 4.1, z: -5.5 };
const SAIL_INDEX = 0;

export class Helmsman {
  constructor(bot, { tickMs = TICK_MS, arriveRadius = 10, maxSeconds = 180 } = {}) {
    this.bot = bot; this.tickMs = tickMs; this.arriveRadius = arriveRadius; this.maxSeconds = maxSeconds;
    this.timer = null; this.stats = { claims: 0 }; this.sailsSet = false;
  }

  ship() {
    const me = this.bot.world.me();
    if (!me || me.relativeToId == null || me.relativeToId === WORLD) return null;
    return { me, ship: this.bot.world.byId(me.relativeToId) };
  }

  _claim(deck, extra = {}) {
    const cur = this.ship(); if (!cur) throw new Error("not aboard");
    this.interp = ((this.interp ?? 0) % 5) + 1;
    this.bot.client.send("MyTankMessage", {
      id: cur.me.id, x: deck.x, y: deck.y, z: deck.z,
      rotationY: cur.me.rotationY ?? 0,
      interpolationIndex: this.interp,
      relativeToId: cur.ship.id, relativeToVehicleId: WORLD, vehiclePositionIndex: 0,
      interactingWithIndex: -1, interactionVector: {},
      ...extra,
    });
    this.stats.claims++;
  }

  /** walk to the mast and tap-hold the sail interactable until the hull answers; resolves true on motion */
  async lowerSails({ holdMs = 10000, deck = SAIL_DECK, index = SAIL_INDEX } = {}) {
    const s0 = this.ship();
    if (!s0?.ship) throw new Error("not aboard a vessel");
    // shuffle to the mast in ship-relative deck coords (legit anim 17 = moving on deck)
    const from = { x: s0.me.x ?? 0, y: s0.me.y ?? 1, z: s0.me.z ?? 0 };
    for (let i = 1; i <= 8; i++) {
      const f = i / 8;
      this._claim({ x: from.x + (deck.x - from.x) * f, y: from.y + (deck.y - from.y) * f, z: from.z + (deck.z - from.z) * f }, { animationState: 17, rotationY: Math.atan2(deck.x - from.x, deck.z - from.z) });
      await sleep(110);
    }
    const start = { x: s0.ship.x, z: s0.ship.z };
    const t0 = Date.now();
    while (Date.now() - t0 < holdMs) {
      this._claim(deck, { animationState: 22, interactingWithIndex: index, interactableActorId: s0.ship.id });
      await sleep(120);
      const cur = this.ship();
      if (cur?.ship && Math.hypot(cur.ship.x - start.x, cur.ship.z - start.z) > 1.2) { this.sailsSet = true; return true; }
    }
    return false; // no motion within hold window
  }

  /** sail the vessel we're aboard toward world {x,z}; resolves {pos} when within arriveRadius */
  sailTo(target) {
    const s0 = this.ship();
    if (!s0?.ship) return Promise.reject(new Error("not aboard a vessel (me().relativeToId is world frame)"));
    this.stop();
    return new Promise((resolve, reject) => {
      const deadline = setTimeout(() => { this.stop(); reject(new Error("sail timeout")); }, this.maxSeconds * 1000);
      this.timer = setInterval(() => {
        const cur = this.ship();
        if (!cur?.ship || cur.ship.x == null) { clearTimeout(deadline); this.stop(); reject(new Error("lost vessel")); return; }
        const { me, ship } = cur;
        const dx = target.x - ship.x, dz = target.z - ship.z;
        const dist = Math.hypot(dx, dz);
        const bearing = Math.atan2(dx, dz);
        this.bot.client.send("MyTankMessage", {
          id: me.id,
          x: me.x ?? 0, y: me.y ?? 0, z: me.z ?? 0,               // hold our deck position
          rotationY: bearing,                                     // THE rudder
          animationState: 7,                                      // observed helming anim
          turretDirectionX: 0, turretDirectionY: bearing,         // gun aim follows heading
          interpolationIndex: (this.interp = ((this.interp ?? 0) % 5) + 1),
          relativeToId: ship.id, relativeToVehicleId: WORLD, vehiclePositionIndex: 0,
          interactingWithIndex: -1, interactionVector: {},
          clientPressedSomethingForAntiAfk: true,
        });
        this.stats.claims++;
        this.bot.world.emit("sailing", { dist, bearing, ship: { x: ship.x, z: ship.z }, stats: this.stats });
        if (dist < this.arriveRadius) { clearTimeout(deadline); this.stop(); resolve({ pos: { x: ship.x, z: ship.z }, dist }); }
      }, this.tickMs);
    });
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
