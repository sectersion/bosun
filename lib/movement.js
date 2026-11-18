// Movement engine — the first behavior layer on top of the world model.
// Grounded in research/MOVEMENT.md (live-capture-derived): legit clients CLAIM positions
// at ~11-13 Hz and the server relays them within a speed envelope (~4 u/s walking).
// Pure functions (steer) are unit-tested; Walker is the loop bound to a Bot.

export const WALK_SPEED = 3.6;   // u/s, comfortably inside observed p90 ~4.4
const TICK_MS = 90;              // ~11 Hz claim cadence
const WORLD = 2 ** 48 - 1;       // RELATIVE_TO_WORLD sentinel (legit client always sends this frame)
const ANIM = { stand: 11, walk: 17 }; // observed: 11 idle, 17 legs moving

/** pure one-step steering toward target, capped at maxStep units */
export function steer(pos, target, maxStep) {
  const dx = target.x - pos.x, dz = target.z - pos.z;
  const d = Math.hypot(dx, dz);
  if (d <= Math.max(0.3, maxStep * 0.6)) return { pos: { ...target, y: pos.y }, arrived: true, heading: d > 0 ? Math.atan2(dx, dz) : 0 };
  const s = Math.min(maxStep, d) / d;
  return { pos: { x: pos.x + dx * s, y: pos.y, z: pos.z + dz * s }, arrived: false, heading: Math.atan2(dx, dz) };
}

export class Walker {
  /** @param {import("./bot.js").Bot} bot must be spawned (world.me() present) */
  constructor(bot, { speed = WALK_SPEED, tickMs = TICK_MS, rubberBand = 1.2 } = {}) {
    this.bot = bot;
    this.speed = speed;
    this.tickMs = tickMs;
    this.rubberBand = rubberBand; // claim-vs-echo drift that triggers re-anchor
    this.interp = 0;
    this.target = null;
    this.estimate = null;   // our best belief (last claim), corrected by echoes
    this.timer = null;
    this.stats = { claims: 0, corrections: 0 };
  }

  /** walk to {x,z}; resolves on arrival {pos}, rejects on timeout/failure */
  walkTo(target, { timeoutMs = 60000, arriveRadius = 0.8 } = {}) {
    const me = this.bot.world.me();
    if (!me) return Promise.reject(new Error("not spawned"));
    this.stop();
    this.target = { ...target };
    this.estimate = { x: me.x, y: me.y ?? 0, z: me.z };
    this.arriveRadius = arriveRadius;
    return new Promise((resolve, reject) => {
      const deadline = setTimeout(() => this._fail(reject, "timeout"), timeoutMs);
      this._resolve = () => { clearTimeout(deadline); resolve({ pos: { ...this.estimate } }); };
      this._reject = reject;
      this._onMoved = (a) => {                       // echo anchoring
        if (!this.bot.world.meId || a.id !== this.bot.world.meId) return;
        const d = Math.hypot(a.x - this.estimate.x, a.z - this.estimate.z);
        if (d > this.rubberBand) { this.estimate = { x: a.x, y: a.y, z: a.z }; this.stats.corrections++; }
      };
      this.bot.world.on("actorMoved", this._onMoved);
      this.timer = setInterval(() => this._step(), this.tickMs);
    }).finally(() => { clearInterval(this.timer); this.timer = null; this.bot.world.removeListener("actorMoved", this._onMoved); });
  }

  _step() {
    const me = this.bot.world.me();
    if (!me || !this.target) return;
    const { pos, arrived, heading } = steer(this.estimate, this.target, this.speed * (this.tickMs / 1000));
    this.estimate = pos;
    this.interp = (this.interp % 5) + 1;             // legit 1..5 cycling buffer slot
    // Full legit claim shape (research/MOVEMENT.md): the coordinate-frame fields are NOT
    // optional in practice — a bare {id,x,y,z} claim is silently discarded by the server.
    this.bot.client.send("MyTankMessage", {
      id: me.id, x: pos.x, y: pos.y, z: pos.z,
      rotationY: heading,
      interpolationIndex: this.interp,
      animationState: arrived ? ANIM.stand : ANIM.walk,
      relativeToId: WORLD,                // on foot: world frame (aboard = ship id — next milestone)
      relativeToVehicleId: WORLD,
      vehiclePositionIndex: 0,
      interactingWithIndex: -1,
      interactionVector: {},
      clientPressedSomethingForAntiAfk: true,
    });
    this.stats.claims++;
    this.bot.world.emit("movement", { phase: arrived ? "arrived" : "walking", pos: { ...pos }, target: this.target, stats: this.stats });
    if (arrived) { this.stop(); this._resolve?.(); }
  }

  _fail(reject, why) { this.stop(); reject(new Error(`walk ${why}`)); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
