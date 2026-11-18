// cosmetics probe: read ship list/costs/level-gates from ServerConstants, exercise the
// cannonball shop (OpenCannonballShop/BuyCannonballs with 0 gold), SelectShip every ship
// type, SelectSkin for skins + a level-locked mesh, hit REST /api/me/equip/, then respawn
// at yourShip. One fresh level-1 guest (0 gold). Self-closes < 60s.
import { register, listServers, profile, GameClient } from "../index.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// canonical ship tankTypes (zB enum ship members from the client bundle)
const SHIPS = { 1: "Sloop", 5: "WarShip", 6: "Clipper", 11: "Cutter", 12: "RowingBoat", 13: "Raft", 14: "SmallRowingBoat", 15: "FirstRate", 16: "FlyingDutchman", 17: "Frigate" };

// raw REST — index.js's api() isn't exported and takes no cookie jar; we only need id-in-path GETs
const HOST = "https://saltyseas.io/saltyseas-game";
const HEADERS = { origin: "https://saltyseas.io", referer: "https://saltyseas.io/app/", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/157.0.0.0" };
async function rawReq(path, method = "GET", body) {
  const t0 = Date.now();
  try {
    const r = await fetch(HOST + path, { method, headers: { ...HEADERS, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body } : {}) });
    const txt = await r.text();
    return { status: r.status, ms: Date.now() - t0, body: txt.slice(0, 300) };
  } catch (e) { return { err: e.message, ms: Date.now() - t0 }; }
}

const me0 = await register();
const id = me0.id;
const servers = await listServers(id);
const pool = servers.filter((s) => [3, 4, 5].includes(Number((s.serverName?.match(/(\d+)\s*$/)?.[1]) ?? s.serverId)));
const server = pool.reduce((a, b) => (b.playerCount < a.playerCount ? b : a));
console.log(`guest id=${id} username=${me0.username}`);
console.log(`server: ${server.serverName} players=${server.playerCount} (pool ${pool.map((s) => `${s.serverName}=${s.playerCount}`).join(", ")})`);

let client;
const watchdog = setTimeout(() => { console.log("WATCHDOG 55s — closing"); try { client?.close(); } catch {} process.exit(1); }, 55000);
watchdog.unref?.();

// baseline profile (the REST source of selectedShip/selectedSkin/gold/level)
const base = await profile(id);
console.log(`\n--- baseline /me/ ---`);
console.log(`gold=${base.gold} level=${base.level} selectedShip=${base.selectedShip} selectedSkin=${base.selectedSkin} selectedCharacterMesh=${base.selectedCharacterMesh} equipped=${JSON.stringify(base.equipped)}`);

client = new GameClient({ id, server });
let constants = null, reset = null;
const events = []; // EventMessage log, verbatim
client.on("error", (e) => console.log("ERR", e.message));
client.on("close", (e) => console.log("CLOSE", JSON.stringify(e)));
client.on("DisconnectReason", (m) => console.log("DISCONNECT", JSON.stringify(m)));
client.on("ServerConstantsMessage", (m) => { constants = m; });
client.on("ResetYourState", (m) => { reset = m; });

const TICK_NOISE = new Set(["WorldMessage", "CannonBallMessage", "RemoveCannonBall", "ScoresMessage", "GlobalExplosion", "TestingMessage", "ChatMessage", "HitMessage", "TankDamageMessage", "HitMeFromMessage"]);
const side = []; // non-tick replies, for send correlation
client.on("message", ({ name, msg }) => {
  if (name === "EventMessage") events.push(msg);
  if (!TICK_NOISE.has(name)) side.push({ name, msg, t: Date.now() });
});

await client.connect();
const waitEvent = (name, ms) => new Promise((r) => { const to = setTimeout(() => r(null), ms); client.once(name, (m) => { clearTimeout(to); r(m); }); });
await (constants ? Promise.resolve() : waitEvent("ServerConstantsMessage", 5000));
await (reset ? Promise.resolve() : waitEvent("ResetYourState", 4000));

async function probe(label, name, obj, settle = 1500) {
  const before = side.length;
  const beforeEv = events.length;
  let err = null;
  try { client.send(name, obj); } catch (e) { err = e.message; }
  await sleep(settle);
  const res = side.slice(before);
  const newEv = events.slice(beforeEv);
  console.log(`\n>>> ${label}: send ${name} ${JSON.stringify(obj)}${err ? " THREW:" + err : ""}`);
  console.log(res.length ? res.map((r) => `    < ${r.name} ${JSON.stringify(r.msg).slice(0, 240)}`).join("\n") : "    (silent — no reply)");
  if (newEv.length) console.log("    EventMessages: " + JSON.stringify(newEv));
  return res;
}

// ---- ServerConstants: ship list, ammo costs, mesh level gates ----
console.log(`\n--- ServerConstantsMessage (19) ---`);
if (constants) {
  const ships = (constants.tankStats ?? []).filter((t) => SHIPS[t.tankType]);
  console.log(`ship tankStats (${ships.length}):`);
  for (const t of ships.sort((a, b) => (a.levelUnlocked ?? 0) - (b.levelUnlocked ?? 0)))
    console.log(`  ${SHIPS[t.tankType]} (type=${t.tankType}) levelUnlocked=${t.levelUnlocked ?? "null"} maxHealth=${t.maxHealth} speed=${t.speed} sailWheelRestAngle=${t.sailWheelRestAngle}`);
  const nonShip = (constants.tankStats ?? []).filter((t) => !SHIPS[t.tankType]);
  console.log(`non-ship tankStats types: [${nonShip.map((t) => t.tankType).join(",")}] (names: ${nonShip.map((t) => t.name).join(",")})`);
  console.log(`cannonBallProps (${(constants.cannonBallProps ?? []).length}) [name/cost/lvlRequired/unlockable]:`);
  for (const c of constants.cannonBallProps ?? [])
    console.log(`  type=${c.cannonBallType} "${c.name}" cost=${c.cost} levelRequired=${c.levelRequired} unlockable=${c.unlockable} isConsumable=${c.isConsumable} heldWeaponClass=${c.heldWeaponClass}`);
  console.log(`characterMeshUnlocks: ${JSON.stringify(constants.characterMeshUnlocks ?? [])}`);
} else console.log("NO ServerConstants received");
console.log(`\nResetYourState.equipment (47): ${JSON.stringify(reset?.equipment)}`);
const yt = reset?.yourTank ?? {};
console.log(`yourTank: id=${yt.id} username=${yt.username} tankType=${yt.tankType} skin=${yt.skin} characterMesh=${yt.characterMesh} at(${yt.x},${yt.y},${yt.z}) isDead=${yt.isDead}`);

// ---- spawn first (fresh ResetYourState.yourTank is empty until we respawn) ----
console.log(`\n--- spawning at Port (location=1) so shop/trader checks run in-world ---`);
{
  const bEv = events.length;
  try { client.send("RequestRespawnMessage", { location: 1 }); } catch (e) { console.log("spawn THREW", e.message); }
  const sp = await waitEvent("ResetYourState", 4000);
  const st = sp?.yourTank ?? {};
  console.log(`spawned yourTank: tankType=${st.tankType} at(${st.x},${st.y},${st.z}) equipment=${JSON.stringify(sp?.equipment)?.slice(0, 120)}`);
  const se = events.slice(bEv); if (se.length) console.log(`spawn events: ${JSON.stringify(se)}`);
  await sleep(2500); // settle into world ticks
}

// ---- REST /api/me/equip/ — bundle shows PUT (docs guessed GET); id can contain '/', must encode ----
console.log(`\n--- REST /api/me/equip/ (id=${id} encoded=${encodeURIComponent(id)}) ---`);
console.log(`GET  : ${JSON.stringify(await rawReq("/api/me/equip/" + encodeURIComponent(id)))}`);
console.log(`PUT {} (no-op probe, empty equip): ${JSON.stringify(await rawReq("/api/me/equip/" + encodeURIComponent(id), "PUT", JSON.stringify({ equip: [] })))}`);

// ---- socket equipped items ----
await probe("get equipped (socket)", "GetMyEquippedItems", { please: true });

// ---- cannonball shop at 0 gold ----
await probe("open cannonball shop", "OpenCannonballShopRequest", { please: true });
const buyType = (constants?.cannonBallProps ?? []).find((c) => c.cost > 0 && c.unlockable !== true)?.cannonBallType ?? 1;
console.log(`(buying cannonBallType=${buyType} with 0 gold)`);
await probe("buy cannonballs @0gold", "BuyCannonballsRequest", { weaponType: buyType, count: 1 });

// ---- SelectShip every ship type ----
console.log(`\n--- SelectShipMessage (79) for each ship type ---`);
// Server ALWAYS echoes ShipSelected({shipType}) — even on rejection it re-asserts the
// current (default) ship. Truth is in the EventMessage in the same window + whether the
// echoed shipType equals what we asked for.
const shipResults = [];
let acceptedShip = null;
for (const [typeStr, shipName] of Object.entries(SHIPS)) {
  const shipType = Number(typeStr);
  const beforeEv = events.length;
  const sel = new Promise((r) => { const to = setTimeout(() => r(null), 900); client.once("ShipSelectedMessage", (m) => { clearTimeout(to); r(m); }); });
  try { client.send("SelectShipMessage", { shipType }); } catch (e) { shipResults.push([shipName, "THREW " + e.message]); continue; }
  const ack = await sel;
  await sleep(300);
  const ev = events.slice(beforeEv);
  const rejection = ev.find((e) => e.primary?.includes("ship"));
  let outcome;
  if (rejection) outcome = `REJECTED "${rejection.primary}: ${rejection.secondary}" (echoed shipType=${ack?.shipType})`;
  else if (ack?.shipType === shipType) outcome = `ACCEPTED (ShipSelected ${shipType})`;
  else outcome = ack ? `ambiguous — echoed ${ack.shipType}, no event` : "silent";
  shipResults.push([shipName + " (" + shipType + ")", outcome]);
  if (!rejection && ack?.shipType === shipType) acceptedShip = shipType;
}
for (const [k, v] of shipResults) console.log(`  ${k}: ${v}`);

// ---- SelectSkinMessage (57) — skins + a gated mesh ----
console.log(`\n--- SelectSkinMessage (57) ---`);
await probe("default skin/mesh 0,0", "SelectSkinMessage", { selectedSkin: 0, characterMesh: 0 });
await probe("skin 1 (mesh 0)", "SelectSkinMessage", { selectedSkin: 1, characterMesh: 0 });
await probe("skin 3 (mesh 0)", "SelectSkinMessage", { selectedSkin: 3, characterMesh: 0 });
const gatedMesh = (constants?.characterMeshUnlocks ?? []).find((m) => m.level > 1)?.characterMesh;
if (gatedMesh != null) await probe(`locked mesh ${gatedMesh} (lvl>1)`, "SelectSkinMessage", { selectedSkin: 0, characterMesh: gatedMesh });

// ---- respawn at yourShip (2), as the client would: {location, shipType:selectedShip} ----
console.log(`\n--- RequestRespawnMessage (26) location=yourShip(2) ---`);
const before = side.length, beforeEv = events.length, beforeReset = reset;
try { client.send("RequestRespawnMessage", { location: 2, ...(acceptedShip != null ? { shipType: acceptedShip } : {}) }); } catch (e) { console.log("THREW", e.message); }
const respawnReply = await waitEvent("ResetYourState", 3500);
console.log(`sent {location:2${acceptedShip != null ? ", shipType:" + acceptedShip : ""}}  (selectedShip after loop=${acceptedShip})`);
console.log(`replies: ${side.slice(before).filter((r) => r.name !== "ResetYourState").map((r) => `${r.name}=${JSON.stringify(r.msg).slice(0, 160)}`).join(" | ") || "(none besides Reset)"}`);
console.log(`new EventMessages: ${JSON.stringify(events.slice(beforeEv))}`);
if (respawnReply) { const n = respawnReply.yourTank ?? {}; console.log(`new yourTank: tankType=${n.tankType} at(${n.x},${n.y},${n.z}) isDead=${n.isDead} — ${respawnReply !== beforeReset ? "server sent a NEW ResetYourState" : "same"}`); }

// ---- final profile: did anything persist? ----
const after = await profile(id);
console.log(`\n--- final /me/ ---`);
console.log(`gold=${after.gold} level=${after.level} selectedShip=${after.selectedShip} selectedSkin=${after.selectedSkin} selectedCharacterMesh=${after.selectedCharacterMesh} equipped=${JSON.stringify(after.equipped)}`);
console.log(`\nall EventMessages seen: ${JSON.stringify(events)}`);

client.close();
process.exit(0);
