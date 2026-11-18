// WorldModel — socket-free game state, the heart of the "mineflayer" layer.
// Feed decoded downlink messages via apply(name, msg); it maintains the actor registry
// (full-state snapshots / delta merges / despawns) and emits typed events.
// Pure: replays offline against recorded sessions (see test-world.js).
//
// Events: spawn(me) tick(m) actorAppear(actor) actorGone(actor) actorMoved(actor)
//         chat(m) event(m) explosion(m) damage(m) scores(m) crew(m)
import { EventEmitter } from "node:events";

const WORLD = 2 ** 48 - 1; // RELATIVE_TO_WORLD sentinel in relativeToId/holderId

export class WorldModel extends EventEmitter {
  constructor() {
    super();
    this.index = 0;          // last WorldMessage sequence id
    this.time = 0;           // shader_time (server clock, seconds)
    this.mapSize = null;
    this.actors = new Map(); // actorId -> merged TankMessage
    this.meId = null;
    this.self = null;        // MyChangingDetails (gold, hunger, level, objective…)
    this.crew = null;
  }

  /** one decoded downlink message, as emitted by GameClient's "message" event */
  apply(name, m) {
    if (!m) return;
    switch (name) {
      case "WorldMessage": return this._world(m);
      case "ResetYourState":
        if (m.yourTank) {
          this.meId = m.yourTank.id;
          this._upsert(m.yourTank, true);
          this.emit("spawn", this.me());
        }
        if (m.equipment) this.equipment = m.equipment;
        if (m.mapSize != null) this.mapSize = m.mapSize;
        return;
      case "ChatMessage": return this.emit("chat", m);
      case "EventMessage": return this.emit("event", m);
      case "GlobalExplosion": return this.emit("explosion", m);
      case "TankDamageMessage": return this.emit("damage", m);
      case "ScoresMessage": return this.emit("scores", m);
      case "MyCrewResponse": this.crew = m; return this.emit("crew", m);
    }
  }

  _world(m) {
    if (m.index != null) this.index = m.index;
    if (m.shaderTime != null) this.time = m.shaderTime;
    if (m.mapSize != null) this.mapSize = m.mapSize;
    const seen = new Set();
    if (m.isFullState) {
      for (const t of m.tanks ?? []) { this._upsert(t, true); seen.add(t.id); }
      for (const id of [...this.actors.keys()]) if (!seen.has(id)) this._remove(id);
    } else {
      for (const t of m.tanks ?? []) { this._upsert(t, false); seen.add(t.id); }
    }
    for (const id of m.actorsToRemove ?? []) this._remove(id);
    if (m.changingDetails) this.self = { ...this.self, ...m.changingDetails };
    this.emit("tick", m);
  }

  _upsert(t, replace) {
    const prev = this.actors.get(t.id);
    if (!prev) {
      this.actors.set(t.id, { ...t });
      return this.emit("actorAppear", this.actors.get(t.id));
    }
    // decoded delta messages omit unchanged fields (protobufjs defaults:false) —
    // null in the delta means "clear", absent means "unchanged"; {...t} carries only set keys
    const next = replace ? { ...t } : Object.assign({}, prev, t);
    this.actors.set(t.id, next);
    if (prev.x !== next.x || prev.y !== next.y || prev.z !== next.z) this.emit("actorMoved", next);
  }

  _remove(id) {
    const a = this.actors.get(id);
    if (a) { this.actors.delete(id); this.emit("actorGone", a); }
  }

  // ---- queries ----
  me() { return this.meId != null ? this.actors.get(this.meId) ?? null : null; }
  byId(id) { return this.actors.get(id) ?? null; }
  *select(fn) { for (const a of this.actors.values()) if (fn(a)) yield a; }
  humans() { return [...this.select((a) => a.classification === 0 && a.gid)]; }
  islands() { return [...this.select((a) => a.classification === 4)]; }
  npcs() { return [...this.select((a) => a.classification >= 1 && a.classification <= 3)]; }
  traders() { return [...this.select((a) => a.classification === 6)]; }
  // Heuristic: vessels are actors other actors ride (passenger manifests / riders' relTo).
  // Precise ship taxonomy (tankType↔CannonBallProps names) is a open research item.
  vessels() { return [...this.select((a) => (a.passengerIds?.ids?.length ?? 0) > 0)]; }
  nearestFrom(pos, fn = () => true, k = 1) {
    return [...this.select(fn)]
      .map((a) => ({ a, d: Math.hypot(a.x - pos.x, a.y - pos.y, a.z - pos.z) }))
      .sort((p, q) => p.d - q.d).slice(0, k);
  }

  /**
   * Vehicle-relative chain resolved to an approximate world position.
   * ponytail: ignores parent ROTATION when composing offsets (fine on-foot/near-identity;
   * exact aboard-offset math needs the parent's quaternion — add when combat bots need it).
   */
  positionOf(actor, maxDepth = 5) {
    let { x = 0, y = 0, z = 0 } = actor;
    let parent = actor, hops = 0;
    while (parent && hops++ < maxDepth) {
      const rid = parent.relativeToId ?? parent.heldBy?.holderId;
      if (rid == null || rid === WORLD || rid === 0) break;
      const up = this.actors.get(rid);
      if (!up) break;
      x += up.x ?? 0; y += up.y ?? 0; z += up.z ?? 0;
      parent = up;
    }
    return { x, y, z };
  }
}
