// probes/config.js — config-domain probe (client state sync: REST config + WS tick/resync/invite).
// Guests A/B/C from runs 1-2 (ids hardcoded — 3 accounts total for this probe).
// Observed: crews + invite tokens are session-scoped (new groupId/token per login, members dropped).
// Modes: node probes/config.js [full|rest|expired]   Self-closes < 60s.
import { register, profile, listServers, getServerConfig, getKeyMapping, serverTime, GameClient } from "../index.js";

const MODE = process.argv[2] ?? "full";
const OLD_RUN1_TOKEN = "71773f3efb9bebaa"; // issued t≈00:47Z run1, crew dissolved on A's reconnect run2

const T0 = Date.now();
const log = (...a) => console.log(`[t+${((Date.now() - T0) / 1000).toFixed(1).padStart(5)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HARD = setTimeout(() => { log("HARD TIMEOUT"); process.exit(2); }, 57000);
const clients = [];
const end = (code = 0) => { for (const c of clients) { try { c.close(); } catch {} } clearTimeout(HARD); process.exit(code); };

const NOISY = new Set(["WorldMessage", "CannonBallMessage", "RemoveCannonBall", "ScoresMessage", "GlobalExplosion", "TankDamageMessage", "HitMeFromMessage"]);
const J = (x) => JSON.stringify(x ?? {}).slice(0, 500);

// ---------- REST ----------
const A = await profile("VAfCqRH1AjE"); // reused guest from run 1
log("profile A (reused):", J(A));
const C = MODE === "expired" ? await profile("o9jVI+4mDsw") : await register();
log(MODE === "expired" ? "profile C (reused):" : "register C:", J(C));

try { log("GET /api/time/ ->", JSON.stringify(await serverTime())); }
catch (e) { log("serverTime err:", e.message); }

const servers = await listServers(A.id);
log("servers:", servers.map((s) => `${s.serverId}:${s.playerCount}`).join(" "));
const cands = servers.filter((s) => [3, 4, 5].includes(s.serverId));
const server = (cands.length ? cands : servers).reduce((a, b) => (b.playerCount < a.playerCount ? b : a));
log(`pick server ${server.serverId} (playerCount ${server.playerCount})`);

let cfg;
try { cfg = await getServerConfig(A.id); log("GET /api/me/config/ FULL ->", JSON.stringify(cfg)); }
catch (e) { log("GET config FAILED:", e.message); }
try { log("GET /api/me/key-mapping/v2/ FULL ->", JSON.stringify(await getKeyMapping(A.id))); }
catch (e) { log("GET key-mapping FAILED:", e.message); }

const BASE = "https://saltyseas.io/saltyseas-game";
const HEADERS = {
  origin: "https://saltyseas.io", referer: "https://saltyseas.io/app/",
  "content-type": "application/json",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/157.0.0.0",
};
async function tryHttp(method, path, id, body) {
  try {
    const r = await fetch(BASE + path + (id ? `?id=${id}` : ""), {
      method, headers: HEADERS, body: body ? JSON.stringify(body) : undefined,
    });
    const t = await r.text();
    log(`${method} ${path} -> HTTP ${r.status} ${t.slice(0, 200)}`);
    return r.status;
  } catch (e) { log(`${method} ${path} -> threw ${e.message}`); return -1; }
}
const k0 = cfg && Object.keys(cfg)[0];
const probeBody = cfg ? { [k0]: !cfg[k0] } : { probe: 1 };
log("config write body:", JSON.stringify(probeBody));
await tryHttp("POST", "/api/me/config/", A.id, probeBody);
await tryHttp("PATCH", "/api/me/config/", A.id, probeBody);
await tryHttp("PUT", "/api/me/config/", A.id, cfg); // full-blob PUT, unchanged — does it echo/store?
await tryHttp("PATCH", "/api/me/", A.id, { config: probeBody }); // setName-style endpoint, config-shaped body
try {
  const cfg2 = await getServerConfig(A.id);
  log("config unchanged after full-blob PUT?", JSON.stringify(cfg2) === JSON.stringify(cfg));
} catch (e) { log("re-GET config failed:", e.message); }
// PUT with a SMALL mutating body: partial-merge or whole-blob replace?
if (cfg) {
  const origView = cfg.viewTypeOffset;
  await tryHttp("PUT", "/api/me/config/", A.id, { viewTypeOffset: 7 });
  await sleep(300);
  try {
    const cfg3 = await getServerConfig(A.id);
    log("after PUT {viewTypeOffset:7}: value =", cfg3.viewTypeOffset,
      "| other keys preserved?", Object.keys(cfg3).length === Object.keys(cfg).length,
      "| full:", JSON.stringify(cfg3).slice(0, 180));
    if (cfg3.viewTypeOffset !== origView) {
      await tryHttp("PUT", "/api/me/config/", A.id, { ...cfg, viewTypeOffset: origView }); // restore
      const cfg4 = await getServerConfig(A.id);
      log("restore PUT -> back to GET-before?", JSON.stringify(cfg4) === JSON.stringify(cfg));
    }
  } catch (e) { log("re-GET after mutate failed:", e.message); }
}
if (MODE === "rest") end(0);

// ---------- WS ----------
const mkStats = () => ({ index: -1, low: 0, normal: 0, fullStates: 0, flags: [], ticksWithSelf: 0, totalTicks: 0 });
const worldA = mkStats();
const worldC = mkStats();
function mkClient(who, id, st) {
  const c = new GameClient({ id, server });
  clients.push(c);
  c.on("error", (e) => log(`[${who}] decode/err`, e.message));
  c.on("close", (e) => log(`[${who}] closed`, J(e)));
  let selfId = null;
  c._setSelf = (x) => { selfId = x; };
  c.on("message", ({ name, msg }) => {
    if (name === "WorldMessage") {
      st.index = Number(msg.index);
      st.flags.push(msg.isLowFrequency ? 1 : 0);
      if (msg.isLowFrequency) st.low++; else st.normal++;
      if (msg.isFullState) st.fullStates++;
      st.totalTicks++;
      if (selfId && (msg.tanks ?? []).some((t) => Number(t.id) === selfId)) st.ticksWithSelf++;
    } else if (!NOISY.has(name)) log(`[${who}] < ${name}`, J(msg));
  });
  return c;
}

const ca = mkClient("A", A.id, worldA);
let tankA = null;
ca.on("ResetYourState", (m) => {
  if (m.yourTank) { tankA = m.yourTank; log("A ResetYourState.yourTank:", J(m.yourTank)); ca._setSelf(Number(m.yourTank.id)); }
  else log("A ResetYourState (no yourTank):", J(m));
});
await ca.connect();
log("A handshake OK");
const crew = await new Promise((r) => ca.once("MyCrewResponse", r));
const token = crew.inviteToken || "";
log("A MyCrewResponse:", J(crew));
log(`A inviteToken "${token}" — same as run1? ${token === "71773f3efb9bebaa"} | B still a member? ${JSON.stringify(crew.members?.map((m) => m.username))}`);
if (MODE === "full") {
ca.send("RequestRespawnMessage", { location: 1 }); // port
await sleep(3500);

// empty-ish MyTankMessage: required fields only — no position/rotation.
if (tankA) {
  for (let i = 0; i < 3; i++) {
    ca.send("MyTankMessage", { id: tankA.id, interpolationIndex: worldA.index });
    log(`A sent minimal MyTankMessage #${i + 1} {id:${tankA.id},interpolationIndex:${worldA.index}}`);
    await sleep(1800);
  }
} else log("A: still no tank id — skipped empty-MyTankMessage test");

// RequestFullState with index deltas measured around each send
async function rfs(index, label) {
  const before = worldA.fullStates, bi = worldA.index;
  ca.send("RequestFullState", { index });
  await sleep(3000);
  log(`RequestFullState ${label} {sent index:${index}, our latest:${bi}} -> fullStates +${worldA.fullStates - before}`);
}
await rfs(worldA.index, "fresh");
await rfs(1, "stale");
}

const cc = mkClient("C", C.id, worldC);
await cc.connect();
const crewC = await new Promise((r) => cc.once("MyCrewResponse", r));
let crewCLatest = crewC;
cc.on("MyCrewResponse", (x) => { crewCLatest = x; });
log("C baseline crew:", J(crewC));
if (token) {
  if (MODE === "full") {
    const flip = ((parseInt(token.slice(-1), 16) + 1) % 16).toString(16);
    const tampered = token.slice(0, -1) + flip;
    log("C sending TAMPERED token", tampered);
    cc.send("MyGroupMessage", { inviteToken: tampered });
    await sleep(2500);
  }
  log("C sending STALE real token from run 1 (crew dissolved at A reconnect):", OLD_RUN1_TOKEN);
  cc.send("MyGroupMessage", { inviteToken: OLD_RUN1_TOKEN });
  await sleep(2500);
  log("C sending VALID token (A's crew, live this session)");
  cc.send("MyGroupMessage", { inviteToken: token });
  await sleep(3500);
  log("C final crew:", J(crewCLatest));
} else log("no token — skipped MyGroupMessage tests");

await sleep(2500);

// ---------- summary ----------
const runs = [];
for (const ch of worldA.flags.join("")) { if (!runs.length || runs.at(-1)[0] !== ch) runs.push([ch, 1]); else runs.at(-1)[1]++; }
log("A WORLD: ticks", worldA.totalTicks, "| normal", worldA.normal, "| lowFreq", worldA.low,
  `| lowShare ${(worldA.low / Math.max(1, worldA.totalTicks)).toFixed(2)}`,
  "| fullStates", worldA.fullStates, "| lastIdx", worldA.index,
  "| ticks containing own tank", worldA.ticksWithSelf);
log("A tick runs (first 30):", runs.slice(0, 30).map(([c, n]) => `${c === "1" ? "L" : "N"}${n}`).join(","));
log("C WORLD: ticks", worldC.totalTicks, "| normal", worldC.normal, "| lowFreq", worldC.low, "| fullStates", worldC.fullStates);
end(0);
