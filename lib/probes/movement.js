// Movement + netcode probe. ONE guest bot. Reads yourTank from ResetYourState,
// drives MyTankMessage every ~100ms, and tests server echo / rubber-band /
// snap-distance via gradual sail vs escalating teleport jumps. Self-closes <60s.
// NOTE: protobufjs maps camelCase keys to the snake_case proto fields (snake
// input is silently DROPPED); decode also returns camelCase. Use camelCase.
import { register, listServers, GameClient } from "../index.js";
import { writeFileSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const now = () => Date.now();

const F = {
  domain: "movement",
  server: null,
  initTank: null,               // full authoritative yourTank at spawn
  resetYourStateTotal: 0,
  resetYourStateSamples: [],    // collapsed consecutive-identical
  eventSamples: [],
  disconnectReason: null,
  serverConstantsKeys: null,
  allBotPositionsSample: null,
  selfFoundInWorld: 0,
  movementUnlocked: false,        // true if server ever advances our actor interp or lets position move off spawn
  unlock: null,                   // first evidence of movement
  spawnAnchor: null,
  selfEchoInWorld: { worldTicks: 0, selfFound: 0, actorInterpSeries: [], lastDelta: null, examples: [] },
  worldTicks: [],                 // {t,index,lowFreq,full,count}
  tickHz: null,
  phase: "boot",
  phaseResults: {},
  sendCount: 0,
  close: null,
  errors: [],
};
const saveErr = (x) => { F.errors.push(String(x)); log("ERR", String(x)); };

let closed = false;
let client = null;
function close() {
  if (closed) return;
  closed = true;
  try { client?.close(); } catch {}
  if (F.worldTicks.length > 1) {
    const dt = F.worldTicks, span = dt[dt.length - 1].t - dt[0].t;
    F.tickHz = { worldMessages: dt.length, spanMs: span, avgIntervalMs: Math.round((span / (dt.length - 1)) * 10) / 10, hz: Math.round(((dt.length - 1) / (span / 1000)) * 10) / 10, sends: F.sendCount };
  }
  try { writeFileSync(new URL("./movement-findings.json", import.meta.url), JSON.stringify(F, null, 1)); } catch (e) { saveErr("write: " + e.message); }
  log("\nmovementUnlocked:", F.movementUnlocked, F.unlock ? JSON.stringify(F.unlock) : "(never advanced off frozen spawn snapshot)");
  log("===FINDINGS===");
  process.exit(0);
}
setTimeout(close, 57000);

// ---- connect ----
const me = await register();
const servers = await listServers(me.id);
const cands = servers.filter((s) => [3, 4, 5].includes(s.serverId));
const server = cands.length ? cands.reduce((a, b) => (b.playerCount < a.playerCount ? b : a), cands[0]) : servers[0];
F.server = { serverId: server.serverId, serverName: server.serverName, playerCount: server.playerCount, maxPlayerCount: server.maxPlayerCount };
log(`server=${F.server.serverId} ${F.server.serverName} pop=${F.server.playerCount}/${F.server.maxPlayerCount} (guest ${me.id})`);

client = new GameClient({ id: me.id, server });
client.on("error", saveErr);
client.on("close", (e) => { F.close = e; log("WS close", JSON.stringify(e)); });

// movement state shared with the ticker
let myTankId = null;
let latestWorldIndex = 0;
let serverSeen = null;        // my position from server (ResetYourState.yourTank or WorldMessage.tanks[self])
let serverActorInterp = null; // the interpolationIndex the server carries for OUR tank
let lastSent = null;
let target = { x: 0, y: 0, z: 0 };
let heading = 0, headingSpin = 0;
let mode = "hold";           // 'hold' | 'sail'
let sailDelta = 0;           // per-tick +x drift
let rich = false;            // echo actor fields (animationState/heldWeapon)
let interpMode = "global";   // 'global' (latest WorldMessage.index) | 'actor' (our own ++ from yourTank.interpIndex)
let actorInterp = 0;         // local actor-index counter

// Detect the first moment the server lets our actor actually move: either it
// advances our per-actor interpolationIndex past the frozen spawn value (1), or
// it reports a self position materially away from the spawn anchor.
function checkUnlock(x, z, actorInterpFromServer, src) {
  if (F.movementUnlocked || F.spawnAnchor == null) return;
  const moved = Math.hypot(x - F.spawnAnchor.x, z - F.spawnAnchor.z) > 1.5;
  const interpAdvanced = typeof actorInterpFromServer === "number" && actorInterpFromServer > F.spawnAnchor.actorInterp;
  if (moved || interpAdvanced) {
    F.movementUnlocked = true;
    F.unlock = { src, phase: F.phase, tMsFromAnchor: Math.round(Math.hypot(x - F.spawnAnchor.x, z - F.spawnAnchor.z)), moved, interpAdvanced, serverX: x, serverZ: z, actorInterp: actorInterpFromServer };
    log(`*** MOVEMENT UNLOCKED [${F.phase}] via ${src}: pos ${(x).toFixed(1)},${(z).toFixed(1)} (anchor ${(F.spawnAnchor.x).toFixed(1)},${(F.spawnAnchor.z).toFixed(1)}), actorInterp ${F.spawnAnchor.actorInterp}->${actorInterpFromServer}`);
  }
}

// ---- received-message handlers ----
client.on("ServerConstantsMessage", (m) => { F.serverConstantsKeys = Object.keys(m); log("< ServerConstants keys:", F.serverConstantsKeys.join(",")); });
client.on("ResetYourState", (m) => {
  const t = m.yourTank;
  F.resetYourStateTotal++;
  const x = t?.x, z = t?.z, fp = m.forcePosition ?? false, ai = t?.interpolationIndex;
  if (t && !F.initTank) F.initTank = t;
  const last = F.resetYourStateSamples[F.resetYourStateSamples.length - 1];
  if (last && last.phase === F.phase && last.forcePosition === fp && last.x === x && last.z === z && last.actorInterp === ai) {
    last.count++;
  } else {
    F.resetYourStateSamples.push({ phase: F.phase, forcePosition: fp, x, z, actorInterp: ai, heldBy: !!t?.heldBy, animationState: t?.animationState, lastSentX: lastSent?.x ?? null, count: 1 });
    log(`< ResetYourState [${F.phase}] forcePos=${fp} x=${x} z=${z} actorInterp=${ai} heldBy=${!!t?.heldBy} anim=${t?.animationState} (we last sent x=${lastSent?.x ?? "-"})`);
  }
  if (t && myTankId == null) myTankId = t.id;
  if (t && typeof t.x === "number") { serverSeen = { x: t.x, y: t.y, z: t.z }; serverActorInterp = ai; checkUnlock(t.x, t.z, ai, "reset"); }
});
client.on("EventMessage", (m) => { F.eventSamples.push({ phase: F.phase, msg: m, lastSentX: lastSent?.x ?? null }); log(`> EventMessage [${F.phase}]`, JSON.stringify(m)?.slice(0, 200)); });
client.on("DisconnectReason", (m) => { F.disconnectReason = m; log("!! DisconnectReason", JSON.stringify(m)?.slice(0, 200)); });
client.on("AllBotPositionsAndDestinations", (m) => {
  if (!F.allBotPositionsSample) F.allBotPositionsSample = { count: m.botPositions?.length ?? 0, sample: (m.botPositions || []).slice(0, 2) };
  log("< AllBotPositionsAndDestinations count=" + (m.botPositions?.length ?? 0));
});
client.on("WorldMessage", (m) => {
  latestWorldIndex = m.index ?? latestWorldIndex;
  const t = now();
  F.worldTicks.push({ t, index: m.index ?? null, lowFreq: m.isLowFrequency ?? false, full: m.isFullState ?? false, tanks: m.tanks?.length ?? 0 });
  F.selfEchoInWorld.worldTicks++;
  const self = (m.tanks || []).find((tk) => tk.id === myTankId);
  if (self) {
    F.selfEchoInWorld.selfFound++;
    if (typeof self.interpolationIndex === "number") F.selfEchoInWorld.actorInterpSeries.push(self.interpolationIndex);
    if (typeof self.x === "number") serverSeen = { x: self.x, y: self.y, z: self.z };
    serverActorInterp = self.interpolationIndex ?? serverActorInterp;
    if (typeof self.x === "number") checkUnlock(self.x, self.z, self.interpolationIndex, "world");
    if (lastSent) {
      const dx = Math.round(((self.x ?? 0) - lastSent.x) * 100) / 100;
      const dz = Math.round(((self.z ?? 0) - lastSent.z) * 100) / 100;
      F.selfEchoInWorld.lastDelta = { dx, dz, serverX: self.x, sentX: lastSent.x };
      if (F.selfEchoInWorld.examples.length < 16)
        F.selfEchoInWorld.examples.push({ phase: F.phase, interpMode, sent: { x: Math.round(lastSent.x), z: Math.round(lastSent.z) }, server: { x: Math.round(self.x), y: self.y, z: Math.round(self.z) }, actorInterp: self.interpolationIndex, anim: self.animationState });
    }
  }
});

await client.connect();
log("connected; requesting respawn (havana = on-foot town)");
client.send("RequestRespawnMessage", { location: 0 });

for (let i = 0; i < 40 && myTankId == null; i++) { await sleep(200); if (i === 20) client.send("RequestRespawnMessage", { location: 0 }); }
if (myTankId == null) { F.errors.push("no yourTank/respawn after ~8s"); myTankId = Number(me.id) || 0; }
if (F.initTank && typeof F.initTank.x === "number") { target = { x: F.initTank.x, y: F.initTank.y, z: F.initTank.z }; heading = F.initTank.rotationY ?? 0; actorInterp = F.initTank.interpolationIndex ?? 0; }
F.spawnAnchor = { x: target.x, z: target.z, actorInterp: F.initTank?.interpolationIndex ?? 1 };
log(`yourTank id=${myTankId} spawn x=${target.x} y=${target.y} z=${target.z} actorInterp=${F.initTank?.interpolationIndex} heldBy=${!!F.initTank?.heldBy} anim=${F.initTank?.animationState} isDead=${F.initTank?.isDead} tankType=${F.initTank?.tankType}`);

// ---- the 100ms sender ----
const ticker = setInterval(() => {
  if (closed) return;
  if (mode === "sail") target.x += sailDelta;
  heading += headingSpin;
  const payload = {
    id: myTankId, x: target.x, y: target.y, z: target.z, rotationY: heading,
    interpolationIndex: interpMode === "actor" ? actorInterp : latestWorldIndex,
    clientPressedSomethingForAntiAfk: true,
  };
  if (interpMode === "actor") actorInterp++;
  if (rich) { payload.animationState = F.initTank?.animationState; payload.heldWeapon = F.initTank?.heldWeapon; payload.rotationX = F.initTank?.rotationX ?? 0; payload.rotationZ = F.initTank?.rotationZ ?? 0; }
  try { client.send("MyTankMessage", payload); lastSent = payload; F.sendCount++; }
  catch (e) { saveErr("send: " + e.message); }
}, 100);

// ---- scripted phases ----
const runPhase = async (name, ms, setup = {}) => {
  F.phase = name;
  if (setup.mode !== undefined) mode = setup.mode;
  if (setup.sailDelta !== undefined) sailDelta = setup.sailDelta;
  if (setup.headingSpin !== undefined) headingSpin = setup.headingSpin;
  if (setup.rich !== undefined) rich = setup.rich;
  if (setup.interpMode !== undefined) interpMode = setup.interpMode;
  const startTick = F.worldTicks.length, startFound = F.selfEchoInWorld.selfFound, startSends = F.sendCount;
  const seenBefore = serverSeen ? { ...serverSeen } : null;
  const aiBefore = serverActorInterp;
  log(`\n--- phase ${name} (${ms}ms) mode=${mode} sailDelta=${sailDelta} interp=${interpMode} rich=${rich} ---`);
  await sleep(ms);
  const dt = F.worldTicks.slice(startTick);
  const res = {
    ms, mode, sailDelta, rich, interpMode,
    sentTicks: F.sendCount - startSends,
    worldTicks: dt.length,
    selfFoundInWorld: F.selfEchoInWorld.selfFound - startFound,
    serverSeenBefore: seenBefore,
    serverSeenAfter: serverSeen ? { ...serverSeen } : null,
    actorInterpBefore: aiBefore, actorInterpAfter: serverActorInterp,
    moved: !!(serverSeen && seenBefore && (Math.abs(serverSeen.x - seenBefore.x) > 1 || Math.abs(serverSeen.z - seenBefore.z) > 1)),
    resetsThisPhase: F.resetYourStateSamples.filter((r) => r.phase === name).map((r) => ({ forcePos: r.forcePosition, x: Math.round(r.x), z: Math.round(r.z), actorInterp: r.actorInterp, heldBy: r.heldBy, count: r.count })),
    eventsThisPhase: F.eventSamples.filter((e) => e.phase === name).map((e) => e.msg),
  };
  F.phaseResults[name] = res;
  log(`    => worldTicks=${res.worldTicks} selfFound=${res.selfFoundInWorld} moved=${res.moved} (x ${Math.round(seenBefore?.x ?? NaN)}->${Math.round(serverSeen?.x ?? NaN)}, z ${Math.round(seenBefore?.z ?? NaN)}->${Math.round(serverSeen?.z ?? NaN)}) actorInterp ${aiBefore}->${serverActorInterp} resets=${res.resetsThisPhase.reduce((s, r) => s + r.count, 0)} events=${res.eventsThisPhase.length}`);
};

// P1. long settle with a gentle drift: test the timeBeforeFirstRound (~15s)
//     lockout hypothesis. If the actor unfreezes at round start, our slow push
//     will suddenly register and checkUnlock fires. 18s covers the 15s margin.
await runPhase("settle", 18000, { mode: "sail", sailDelta: 1, headingSpin: 0 });

// P2. sail with GLOBAL world index (mission's prescribed method)
await runPhase("sail-global-interp", 4000, { mode: "sail", sailDelta: 3, headingSpin: 0.02 });

// P3. sail with ACTOR index + rich echo of authoritative actor fields
actorInterp = (serverActorInterp ?? 0) + 1;
await runPhase("sail-actor-interp-rich", 4000, { mode: "sail", sailDelta: 3, headingSpin: 0.02, rich: true, interpMode: "actor" });

// P4. stop and see if server holds the new position or rubber-bands back
await runPhase("hold-after", 2000, { mode: "hold" });

// P5. escalating single-frame teleport jumps from where the server last saw us
for (const jump of [120, 300]) {
  if (serverSeen) target = { x: serverSeen.x + jump, y: serverSeen.y, z: serverSeen.z };
  else target.x += jump;
  const name = `teleport-${jump}`;
  F.phase = name;
  const startTick = F.worldTicks.length, startFound = F.selfEchoInWorld.selfFound;
  const seenBefore = serverSeen ? { ...serverSeen } : null;
  const resetBefore = F.resetYourStateTotal, evtBefore = F.eventSamples.length;
  log(`\n--- phase ${name}: jump to x=${Math.round(target.x)} (server had x=${Math.round(seenBefore?.x ?? NaN)}) interp=${interpMode} ---`);
  await sleep(2500);
  const jres = {
    jump, interpMode, rich, serverHad: seenBefore, targetAfterJump: { ...target },
    serverSeenAfter: serverSeen ? { ...serverSeen } : null,
    selfFoundInWorld: F.selfEchoInWorld.selfFound - startFound,
    worldTicks: F.worldTicks.slice(startTick).length,
    resetYourStateCount: F.resetYourStateTotal - resetBefore,
    eventCount: F.eventSamples.length - evtBefore,
    acceptedJump: !!(serverSeen && seenBefore && Math.abs(serverSeen.x - seenBefore.x) >= jump * 0.5),
  };
  F.phaseResults[name] = jres;
  log(`    => serverSeen x=${Math.round(serverSeen?.x ?? NaN)} resets=${jres.resetYourStateCount} events=${jres.eventCount} accepted=${jres.acceptedJump}`);
  if (F.disconnectReason) { log("!! disconnected during jump, stopping"); break; }
}

clearInterval(ticker);
close();
