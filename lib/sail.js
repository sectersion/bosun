// Sailing — the helmsman controller. ⚠️ UNVERIFIED / WIP: the model below is derived from a
// live capture, but the first on-water test (research/sail-live.js) steered a fresh bot's ship
// with ZERO forward motion in 180s. Heading + rudder are correct (see research/MOVEMENT.md);
// the missing piece is PROPULSION — ships appear wind/physics-driven server-side and a
// freshly-spawned ship at the dock does not move from rudder input alone. Next experiment:
// spawn aboard, send NO claims for 60s, observe whether the hull drifts (wind physics) or is
// anchored (needs a departure/sail mechanic not yet on the wire).
// Model facts (validated from capture):
// • vessel sails along its own rotationY (velocity-vs-bow offset ≈ 0.0°, n=1817)
// • helmsman camera yaw IS the rudder: ship turns toward our rotationY at ~0.075 rad/s (84:4)
// • aboard = claims carry relativeToId=shipId, coords ship-relative; board/disembark = frame flip
import { WORLD } from "./world.js";

const TICK_MS = 100;

export class Helmsman {
  constructor(bot, { tickMs = TICK_MS, arriveRadius = 10, maxSeconds = 180 } = {}) {
    this.bot = bot; this.tickMs = tickMs; this.arriveRadius = arriveRadius; this.maxSeconds = maxSeconds;
    this.timer = null; this.stats = { claims: 0 };
  }

  ship() {
    const me = this.bot.world.me();
    if (!me || me.relativeToId == null || me.relativeToId === WORLD) return null;
    return { me, ship: this.bot.world.byId(me.relativeToId) };
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
