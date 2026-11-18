// Fleet LIVE: reconnects the registered roster to a populated server, then behaves like
// 50 visible players: intro wave, slow inter-bot banter, keyword-gated replies to humans,
// world-event commentary. Hard rate cap so it stays entertainment. usage: node fleet-live.js [serverName] [minutes]
import { readFileSync } from "node:fs";
import { listServers, GameClient } from "../lib/index.js";

const serverName = process.argv[2] || "Server 2";
const MINUTES = Number(process.argv[3] || 15);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (a) => a[(Math.random() * a.length) | 0];
const t0 = Date.now();
const stamp = () => (((Date.now() - t0) / 1000) | 0) + "s";

const roster = JSON.parse(readFileSync("fleet-accounts.json", "utf8"));
if (!roster.length) { console.log("no roster"); process.exit(1); }
const servers = await listServers(roster[0].id);
const server = servers.find((s) => s.serverName === serverName) ?? servers[1];
console.log(`[${stamp()}] ${server.serverName} ${server.playerCount}/${server.maxPlayerCount}, reconnecting ${roster.length} fleet`);

// ---- global send budget: max 6 fleet messages per 30s ----
const sends = [];
const budgetOK = () => { const now = Date.now(); while (sends.length && now - sends[0] > 30000) sends.shift(); return sends.length < 6; };
const bots = [];
async function emit(b, msg) {
  if (!b || !budgetOK()) return false;
  try { b.c.send("MyChatMessage", { isGroup: false, message: msg }); sends.push(Date.now()); return true; } catch { return false; }
}

for (const a of roster) {
  const c = new GameClient({ id: a.id, server });
  c.on("error", () => {});
  const b = { ...a, c, ready: false };
  bots.push(b);
  try { await c.connect(); } catch { continue; }
  c.once("MyCrewResponse", () => { c.send("RequestRespawnMessage", { location: 1 }); setTimeout(() => (b.ready = true), 1500); });
  await sleep(80);
}
await sleep(3000);
console.log(`[${stamp()}] fleet online: ${bots.filter((b) => b.ready).length}`);

// ---- 1. intro wave ----
const INTROS = ["hi from Claude Code", "hello Server {s}, the fleet has arrived", "50 bots, 1 laptop, zero regrets", "we come in peace (and protobuf)", "greetings, mortals — bosun reporting", "just here for the kraken"];
for (const b of bots) { emit(b, pick(INTROS).replace("{s}", serverName)); await sleep(300); }
console.log(`[${stamp()}] intro wave sent`);

// ---- 2. banter between bots ----
const BANTER = [["anyone else new here?", "first time sailing. theoretically."], ["does anyone actually know how to sail?", "pretty sure we just... drift"], ["I can see everything in this server as a data structure", "show off"], ["if a bot spawns on a port and nobody chats with it, does it make a sound?", "brb testing"], ["who parked the warship on the reef", "that was me"], ["this is fine", "this is fine"]];
const banterTimer = setInterval(async () => {
  const pair = pick(BANTER); const [b1, b2] = bots.filter(() => true).sort(() => Math.random() - 0.5);
  if (await emit(b1, pair[0])) setTimeout(() => emit(b2, pair[1]), 2500);
}, 55000);

// ---- 3+4. the ear: reacts to human chat + world events ----
const ear = bots[0];
const RULES = [
  { re: /\b(bots?|robots?|ai|claude|real|human|scripts?|code|automat)\b/i, replies: ["guilty — 50 Node.js bots, open source: github.com/sectersion/bosun", "yes, bots. built with an unofficial API client called bosun. ask us anything", "all 50 of us run from one laptop. the CPU is nervous"] },
  { re: /\b(how many|who are you|what are you)\b/i, replies: ["50 of us. we just appeared", "a fleet. bosun-01 through bosun-50. we're friendly"] },
  { re: /\b(hi|hello|hey|yo|sup)\b/i, chorus: ["hi!", "hello there", "hey! welcome to the fleet's fan club", "oh nice, someone said hi back"] },
  { re: /\b(kraken)\b/i, replies: ["we don't talk about the kraken", "the kraken took our feelings once"] },
  { re: /\b(stop|leave|go away|spam|kick|ban)\b/i, replies: ["we'll drift off in a few minutes, promise", "fair — staying quiet now", "no spam intended! we're leaving soon 🫡"] },
];
let lastHuman = 0, muted = false;
ear.c.on("ChatMessage", (m) => {
  if (m.username?.startsWith("bosun-") || m.username === "Server" || muted) return;
  const now = Date.now(); if (now - lastHuman < 8000) return; // one reply per 8s max per human burst
  lastHuman = now;
  const text = m.message || "";
  for (const r of RULES) if (r.re.test(text)) {
    const who = r.chorus ? bots.slice(1, 8) : bots;
    for (const line of [pick(r.replies ?? r.chorus)]) {
      const b = pick(who); emit(b, line);
      if (/leaving now|quiet/.test(line)) { muted = true; setTimeout(() => (muted = false), 60000); }
    }
    return;
  }
  if (text.includes("?") && Math.random() < 0.5) emit(pick(bots.slice(1)), "no idea, but ask the one with the bigger cannon");
});
ear.c.on("GlobalExplosion", () => { if (Math.random() < 0.4) emit(pick(bots), pick(["I felt that one", "someone's having a day", "that was probably fine"])); });

// ---- farewell + cleanup ----
setTimeout(async () => {
  clearInterval(banterTimer);
  for (const b of bots) emit(b, pick(["that's our time — thanks for having us 🫡", "fleet out. github.com/sectersion/bosun", "goodbye and smooth sailing"]));
  await sleep(4000);
  console.log(`[${stamp()}] total fleet messages sent: ${sends.length}`);
  for (const b of bots) { try { b.c.close(); } catch {} }
  process.exit(0);
}, MINUTES * 60000);
console.log(`[${stamp()}] fleet is LIVE on ${server.serverName} for ${MINUTES} min`);
