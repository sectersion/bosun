// Movement-authority unlock experiment: guest vs registered account owning a ship.
// Protocol: connect -> SelectShip(Sloop=1) -> respawn yourShip(2) -> read yourTank ->
// claim a walking position (+3 units/tick on x) for ~4s -> compare server-observed
// self-position (WorldMessage.tanks[id]) against claims and spawn anchor.
import { register, registerAccount, listServers, GameClient } from "./index.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const servers = await listServers((await register()).id);
const server = servers.filter((s) => s.playerCount < s.maxPlayerCount).sort((a, b) => a.playerCount - b.playerCount)[0] ?? servers[4];

async function trial(label, id) {
  const c = new GameClient({ id, server });
  const t = { label, id, shipSel: null, respawnEvt: null, anchor: null, tankId: null, worldSeen: 0, drift: null };
  c.on("error", (e) => console.log(`  [${label}] err ${e.message}`));
  c.on("ShipSelectedMessage", (m) => (t.shipSel = m));
  c.on("EventMessage", (m) => (t.respawnEvt = t.respawnEvt ?? m));
  c.on("ResetYourState", (m) => { if (m.yourTank && t.tankId == null) { t.tankId = m.yourTank.id; t.anchor = { x: m.yourTank.x, y: m.yourTank.y, z: m.yourTank.z, tankType: m.yourTank.tankType }; } });
  await c.connect();
  await new Promise((r) => c.once("MyCrewResponse", r));
  c.send("SelectShipMessage", { shipType: 1 }); // Sloop, level 1
  await sleep(800);
  c.send("RequestRespawnMessage", { location: 2, shipType: 1 }); // your ship
  await sleep(2500);
  if (t.tankId == null) { c.close(); return { ...t, result: "never spawned" }; }
  let claimed = { x: t.anchor.x, z: t.anchor.z };
  let serverPos = null;
  c.on("WorldMessage", (m) => {
    if (Array.isArray(m.tanks)) for (const tk of m.tanks)
      if (tk.id === t.tankId && tk.x != null) serverPos = { x: tk.x, z: tk.z };
    t.worldSeen++;
  });
  let interp = 0;
  const loop = setInterval(() => {
    interp++; claimed = { x: claimed.x + 3, z: claimed.z };
    c.send("MyTankMessage", { id: t.tankId, x: claimed.x, y: claimed.y ?? t.anchor?.y ?? 2.6, z: claimed.z, rotationY: 0, interpolationIndex: interp, clientPressedSomethingForAntiAfk: true });
  }, 100);
  await sleep(4500);
  clearInterval(loop);
  const moved = serverPos && t.anchor ? Math.hypot(serverPos.x - t.anchor.x, serverPos.z - t.anchor.z) : 0;
  t.drift = +moved.toFixed(1);
  t.claimedDrift = +Math.hypot(claimed.x - t.anchor.x, 0).toFixed(1);
  t.result = moved > 5 ? "RELAYED — client authority live" : "re-anchored (claims discarded)";
  c.close();
  return t;
}

const guest = await register();
const g = await trial("guest", guest.id);
const acct = await register();
await registerAccount(acct.id, "sail" + Math.random().toString(36).slice(2, 8) + "@salty.invalid", "saltyFleet1");
const a = await trial("account", acct.id);

for (const r of [g, a])
  console.log(`${r.label.padEnd(8)} ship=${JSON.stringify(r.shipSel)?.slice(0, 40)} spawn=${JSON.stringify(r.anchor)} claims=${r.claimedDrift} serverDrift=${r.drift} -> ${r.result}`);
process.exit(0);
