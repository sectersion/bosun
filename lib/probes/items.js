// items probe v3: walk to a ground item via MyTankMessage, complete the
// pickup/carry/drop/eat cycle, capture full EquippedItems echoes. Self-closes < 55s.
import { register, listServers, GameClient } from "../index.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = (x, n = 300) => JSON.stringify(x)?.slice(0, n);

const servers = await listServers((await register()).id);
const pool = servers.filter((s) => [3, 4, 5].includes(Number(s.serverName?.match(/(\d+)\s*$/)?.[1])));
const server = pool.reduce((a, b) => (b.playerCount < a.playerCount ? b : a));
console.log(`server: ${server.serverName} players=${server.playerCount}`);

const me = await register();
const client = new GameClient({ id: me.id, server });
setTimeout(() => { console.log("WATCHDOG — closing"); try { client?.close(); } catch {} process.exit(1); }, 50000);

const latest = new Map();
const hunger = [];
const side = [];
const NOISE = new Set(["WorldMessage", "TankDamageMessage", "PlaySoundMessage", "CannonBallMessage", "RemoveCannonBall", "ScoresMessage", "GlobalExplosion", "TestingMessage", "ChatMessage", "MyCrewResponse", "OpenCrewsResponse"]);
client.on("error", (e) => console.log("ERR", e.message));
client.on("close", (e) => console.log("CLOSE", JSON.stringify(e)));
client.on("message", ({ name, msg }) => {
  if (name === "WorldMessage") {
    for (const t of msg.tanks ?? []) latest.set(t.id, { ...(latest.get(t.id) ?? {}), ...t });
    for (const id of msg.actorsToRemove ?? []) latest.delete(id);
    if (msg.changingDetails) hunger.push([Date.now() / 1000, msg.changingDetails]);
  } else if (!NOISE.has(name)) side.push({ name, msg });
});

await client.connect();
const t0 = Date.now() / 1000;
await new Promise((r) => client.once("MyCrewResponse", r));
client.send("RequestRespawnMessage", { location: 1 });
await Promise.race([new Promise((r) => client.once("ResetYourState", r)), sleep(6000)]);
await sleep(3500);
const self = [...latest.values()].find((t) => t.username === me.username);
if (!self) { console.log("FATAL no self tank"); client.close(); process.exit(1); }
console.log(`self id=${self.id} at(${self.x},${self.y},${self.z}) carried=${self.carriedItemId}`);
const d2 = (t) => ((t.x ?? 0) - self.x) ** 2 + ((t.y ?? 0) - self.y) ** 2 + ((t.z ?? 0) - self.z) ** 2;
const items = [...latest.values()].filter((t) => t.itemType !== undefined).sort((a, b) => d2(a) - d2(b));
const tgt = items[0];
console.log(`items=${items.length} nearest=${tgt.username} type=${tgt.itemType} at(${tgt.x},${tgt.y},${tgt.z}) d=${Math.sqrt(d2(tgt)).toFixed(1)}m`);

async function probe(label, name, obj, ms = 2500) {
  const before = side.length;
  let err = null;
  try { client.send(name, obj); } catch (e) { err = e.message; }
  await sleep(ms);
  console.log(`\n>>> ${(Date.now() / 1000 - t0).toFixed(1)}s ${label}: ${name} ${J(obj, 120)}${err ? " THREW " + err : ""}`);
  console.log(side.slice(before).length ? side.slice(before).map((r) => `    < ${r.name} ${J(r.msg, 320)}`).join("\n") : "    (silent)");
}

// walk toward tgt in ~1m steps (14 steps, 180ms apart)
let ii = self.interpolationIndex ?? 0;
const ux = (tgt.x - self.x), uy = (tgt.y - self.y), uz = (tgt.z - self.z);
const L = Math.hypot(ux, uy, uz);
const steps = Math.max(1, Math.round(L));
for (let i = 1; i <= steps; i++) {
  const f = i / steps;
  client.send("MyTankMessage", { id: self.id, x: self.x + ux * f, y: self.y + uy * f, z: self.z + uz * f, interpolationIndex: ++ii });
  await sleep(180);
}
const at = latest.get(self.id);
console.log(`\nafter walk: server has me at(${at?.x},${at?.y},${at?.z})`);
await probe("PICKUP in range", "PickUpItemMessage", { actorId: tgt.id });
const meNow = latest.get(self.id);
console.log(`me.carriedItemId=${meNow?.carriedItemId} | tgt in world=${latest.has(tgt.id)} | bag now: ${J((await side.find((s) => s.name === "EquippedItems"))?.msg, 200)}`);
await probe("EAT wine (weaponType 3?)", "EatItemMessage", { weaponType: 3 }, 2000);
await probe("DROPBAG wine", "DropBagItemMessage", { weaponType: 3 }, 2000);
await probe("DROP carried", "DropItemMessage", { foo: true, x: (at?.x ?? self.x) + 1, y: at?.y ?? self.y, z: at?.z ?? self.z }, 2000);
await probe("PULL 2nd item in range", "PullActorMessage", { actorId: items[1]?.id ?? tgt.id }, 2000);
const eq0 = [...side].reverse().find((s) => s.name === "EquippedItems")?.msg;
await probe("UPDATE reverse held (valid multiset)", "UpdateEquippedItems", { bagItems: eq0?.bagItems ?? [], heldItems: [...(eq0?.heldItems ?? [])].reverse(), cannonballs: eq0?.cannonballs ?? [] });
await probe("UPDATE held[0].count+1 (invalid)", "UpdateEquippedItems", { bagItems: eq0?.bagItems ?? [], heldItems: (eq0?.heldItems ?? []).map((s, i) => (i === 0 ? { ...s, count: (s.count ?? 0) + 1 } : s)), cannonballs: eq0?.cannonballs ?? [] });
await probe("REQUEST FULL STATE (hunger?)", "RequestFullState", { index: 0 }, 2000);
await probe("FISH reel", "FishingReelMessage", { reeling: true }, 2000);
await probe("GetMyEquippedItems (3rd test)", "GetMyEquippedItems", { please: true }, 2000);

console.log(`\nItemCount: ${J(side.filter((s) => s.name === "ItemCountMessage").map((s) => s.msg))}`);
console.log(`EquippedItems count: ${side.filter((s) => s.name === "EquippedItems").length}`);
const hh = hunger.map(([t, c]) => [+(t - t0).toFixed(1), c.hunger, c.gold]);
console.log(`hunger samples (${hh.length}): ${J(hh.filter((_, i) => i % 5 === 0 || i === hh.length - 1))}`);
client.close();
process.exit(0);
