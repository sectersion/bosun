// Combat probe: solo fire -> cross-fire duel -> death/respawn. 2 guests, 60s cap.
import { register, listServers, GameClient } from "../index.js";

const T0 = Date.now();
setTimeout(() => { console.log(JSON.stringify({ t: t(), event: "WATCHDOG" })); process.exit(1); }, 57000);
const t = () => Math.round(Date.now() - T0);
const LOG = (o) => console.log(JSON.stringify({ t: t(), ...o }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, label) =>
  Promise.race([p, sleep(ms).then(() => { throw new Error("timeout " + label); })]);

const WATCH = new Set([
  "CannonBallMessage", "RemoveCannonBall", "HitMessage", "TankDamageMessage",
  "HitMeFromMessage", "GlobalExplosion", "GibMessage", "ShowRespawnDialogueMessage",
  "PlaySoundMessage",
]);

const norm = (v) => {
  const m = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: +(v.x / m).toFixed(4), y: +(v.y / m).toFixed(4), z: +(v.z / m).toFixed(4) };
};
const rand = () => Math.floor(Math.random() * 2 ** 52);

function mkBot(tag, username) {
  const b = { tag, username, tankId: null, pos: null, dead: false, health: null,
    ballProps: null, counts: {}, respawning: false };
  b.readyP = new Promise((res) => (b._ready = res));
  return b;
}

function onMsg(b, { name, id, msg }) {
  b.counts[name] = (b.counts[name] || 0) + 1;
  if (name === "DisconnectReason" || name === "EventMessage") {
    LOG({ bot: b.tag, recv: name, msg });
    if (name === "ShowRespawnDialogueMessage" && msg.show) b.dead = true;
    return;
  }
  if (WATCH.has(name)) {
    LOG({ bot: b.tag, recv: name, msg });
    if (name === "CannonBallMessage" && msg.firedById === b.tankId) LOG({ bot: b.tag, ourShotBroadcast: true, msg });
  }
  if (name === "ServerConstantsMessage") {
    b.ballProps = msg.cannonBallProps || [];
    if (!b.constLogged) { b.constLogged = true; LOG({ bot: b.tag, recv: name, cannonBallProps: b.ballProps, nTankStats: (msg.tankStats||[]).length }); }
  }
  if (name === "ResetYourState") {
    if (msg.yourTank) {
      b.tankId = msg.yourTank.id;
      if (Number.isFinite(msg.yourTank.x)) b.pos = { x: msg.yourTank.x, y: msg.yourTank.y, z: msg.yourTank.z };
      b.health = msg.yourTank.health; b.dead = !!msg.yourTank.isDead;
      b._spawned = true;
    }
    LOG({ bot: b.tag, recv: name, yourTank: msg.yourTank, keys: Object.keys(msg), nStatic: (msg.staticActors||[]).length });
  }
  if (name === "WorldMessage") {
    const me = (msg.tanks || []).find((tk) =>
      (b.tankId != null && tk.id === b.tankId) || tk.username === b.username);
    if (!b._fullLogged && msg.isFullState) { b._fullLogged = true; LOG({ bot: b.tag, recv: "WorldMessage.full", index: msg.index, nTanks: (msg.tanks||[]).length, tanksSample: (msg.tanks||[]).slice(0,3) }); }
    if (msg.tanks?.length) {
      const bb = msg.tanks.filter((tk) => tk.tankType === 9 && Number.isFinite(tk.x))
        .sort((u, v) => Math.hypot((u.x ?? 0) - (b.pos?.x ?? 0), (u.z ?? 0) - (b.pos?.z ?? 0)) - Math.hypot((v.x ?? 0) - (b.pos?.x ?? 0), (v.z ?? 0) - (b.pos?.z ?? 0)))
        .slice(0, 4);
      if (bb.length) b.barrels = bb; // static actors only appear in full ticks — never wipe with a delta
    }
    if (me) {
      if (b.tankId == null) b.tankId = me.id;
      if (Number.isFinite(me.x)) b.pos = { x: me.x, y: me.y, z: me.z };
      const wasDead = b.dead;
      b.dead = !!me.isDead;
      if (Number.isFinite(me.health)) b.health = me.health;
      if (wasDead !== b.dead || b.health !== b._lastHealth) {
        b._lastHealth = b.health;
        LOG({ bot: b.tag, selfState: { tankId: b.tankId, ...b.pos, health: b.health, isDead: b.dead, tankType: me.tankType, heldWeapon: me.heldWeapon, animationState: me.animationState } });
      }
      if (!b.dead && !b._readyDone) { b._readyDone = true; b._ready(); }
    }
    if (msg.actorsToRemove?.length) LOG({ bot: b.tag, recv: "WorldMessage", actorsToRemove: msg.actorsToRemove, index: msg.index });
  }
}

function fire(b, dir, phase, opts = {}) {
  const p = b.pos || { x: 0, y: 0, z: 0 };
  const payload = { x: p.x, y: p.y, z: p.z, directionX: dir.x, directionY: dir.y,
    directionZ: dir.z, cannonBallType: opts.ballType ?? (b.ballProps?.[0]?.cannonBallType ?? 0),
    id: opts.projId ?? b.tankId };
  try {
    b.client.send("MyFiringMessage", payload);
    LOG({ bot: b.tag, sent: "MyFiringMessage", phase, payload });
  } catch (e) { LOG({ bot: b.tag, sendError: String(e), phase }); }
}

async function spawnBot(tag, me, server, loc, readyMs) {
  const b = mkBot(tag, me.username);
  b.id = me.id;
  b.client = new GameClient({ id: me.id, server });
  b.client.on("message", (m) => onMsg(b, m));
  b.client.on("error", (e) => LOG({ bot: tag, decodeError: String(e) }));
  b.client.on("close", (e) => LOG({ bot: tag, event: "wsClose", e }));
  await withTimeout(b.client.connect(), 15000, tag + " handshake");
  LOG({ bot: tag, username: b.username, event: "handshake" });
  try {
    b.client.send("RequestRespawnMessage", { location: loc });
    LOG({ bot: tag, sent: "RequestRespawnMessage", payload: { location: loc } });
  } catch (e) { LOG({ bot: tag, sendError: String(e), sent: "RequestRespawnMessage" }); }
  try { await withTimeout(b.readyP, readyMs, tag + " spawn"); }
  catch (e) { LOG({ bot: tag, warn: e.message, dead: b.dead }); }
  return b;
}

const meA = await register();
const meB = await register();
LOG({ event: "registered", a: meA.id, b: meB.id });
const servers = await listServers(meA.id);
LOG({ event: "servers", list: servers.map((s) => `${s.serverId}:${s.playerCount}/${s.maxPlayerCount}`).join(" ") });
const cand = servers.filter((s) => [3, 4, 5].includes(s.serverId));
const server = cand.sort((x, y) => x.playerCount - y.playerCount)[0];
LOG({ event: "picked", serverId: server.serverId, playerCount: server.playerCount });

// Phase 1: A spawns and fires solo while B joins. Port (loc 1) is a proven safe zone; use Jungle (loc 3) for PvP.
const A = await spawnBot("A", meA, server, 3, 10000);
fire(A, { x: 1, y: 0, z: 0 }, "solo-jungle-fists");
const Bp = spawnBot("B", meB, server, 3, 10000); // overlaps A's solo window
const B = await Bp;
A.foe = B; B.foe = A;

// Phase 1b: walk inland via MyTankMessage state updates (client-reported position; server is authoritative elsewhere).
async function walk(b, dist) {
  b.rot = b.rot ?? { rotationX: 0, rotationY: 2.6, rotationZ: 0 };
  let i = 1000;
  for (let d = 0; d < dist; d += 2.5) {
    i++;
    b.pos = { x: b.pos.x + 2.5, y: b.pos.y, z: b.pos.z };
    try { b.client.send("MyTankMessage", { id: b.tankId, username: b.username, ...b.pos, ...b.rot, interpolationIndex: i, heldWeapon: 4 }); }
    catch (e) { LOG({ bot: b.tag, sendError: String(e), phase: "walk" }); break; }
    await sleep(125);
  }
  LOG({ bot: b.tag, walked: dist, pos: b.pos });
}
await Promise.all([walk(A, 160), walk(B, 120)]);
await sleep(1000);
LOG({ event: "postWalkPos", A: A.pos, B: B.pos, dist: +Math.hypot(A.pos.x - B.pos.x, A.pos.z - B.pos.z).toFixed(1) });
for (const b of [A, B]) LOG({ bot: b.tag, ballPropsTable: (b.ballProps || []).map((p, i) => `${i}:cbt=${p.cannonBallType ?? 0}:${p.name}${p.isMelee ? ":melee" : ""}:lvl${p.levelRequired}:dmg${p.damage}:spd${p.speed}`) });
if (A.pos && B.pos) LOG({ event: "spawnPos", A: A.pos, B: B.pos, samePoint: Math.hypot(A.pos.x - B.pos.x, A.pos.z - B.pos.z) < 1 });

// Phase 2: pistol duel (cbt 1, dmg 4 vs 10 HP) — aim at foe, until someone dies or 6 volleys.
for (let k = 0; k < 6; k++) {
  const order = k % 2 === 0 ? [B, A] : [A, B];
  let anyDead = A.dead || B.dead;
  for (const b of order) {
    if (b.dead) continue;
    const foe = b.foe;
    if (!foe || foe.dead || !b.pos) continue;
    const p = b.pos, f = foe.pos || p;
    const d = Math.hypot(f.x - p.x, f.y - p.y, f.z - p.z);
    const dir = d < 1 ? { x: 1, y: 0, z: 0 } : norm({ x: f.x - p.x, y: (f.y - p.y) + d * 0.01, z: f.z - p.z });
    fire(b, dir, `duel${k} Pistol->${foe.tag} dist=${d.toFixed(1)}`, { ballType: 1, projId: rand() });
    await sleep(2700);
  }
  if (A.dead && B.dead) break;
}

// Phase 3: death watch + respawn test.
for (let i = 0; i < 10; i++) {
  await sleep(1000);
  for (const b of [A, B]) {
    if (b.dead && !b.respawning) {
      b.respawning = true;
      try { b.client.send("RequestRespawnMessage", { location: 3 }); LOG({ bot: b.tag, sent: "RequestRespawnMessage post-death", payload: { location: 3 } }); }
      catch (e) { LOG({ bot: b.tag, sendError: String(e) }); }
    }
  }
}

LOG({ event: "summary", A: { counts: A.counts, tankId: A.tankId, health: A.health, dead: A.dead },
  B: { counts: B.counts, tankId: B.tankId, health: B.health, dead: B.dead } });
A.client.close(); B.client.close();
await sleep(500);
process.exit(0);
