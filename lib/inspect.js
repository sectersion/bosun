// Inspector — visibility for what a bot is doing: a live one-line status feed plus an
// optional JSONL trace for post-hoc replay/plotting. Dependency-free, stderr by default
// so it never corrupts stdout JSON from scripts.
//   attachInspector(bot, { trace: "bot-01.jsonl" })
import { createWriteStream } from "node:fs";

const fmt = (n, d = 1) => (n == null ? "?" : Number(n).toFixed(d));

export function attachInspector(bot, { every = 1000, out = process.stderr, trace = null, label = "bot" } = {}) {
  const events = [];                                        // ring of recent {name, brief}
  const note = (name, brief) => events.push({ t: Date.now(), name, brief }) && events.splice(0, Math.max(0, events.length - 12));
  const subs = [
    ["chat", (m) => note("chat", `${m.username}: ${String(m.message).slice(0, 40)}`)],
    ["explosion", (m) => note("boom", `@${fmt(m.x, 0)},${fmt(m.z, 0)}`)],
    ["damage", (m) => note("damage", `tank ${m.tankId}`)],
    ["actorAppear", (a) => note("appear", `${a.username ?? a.tankType ?? "?"}@${fmt(a.x, 0)},${fmt(a.z, 0)}`)],
    ["actorGone", (a) => note("gone", `${a.username ?? a.id}`)],
    ["event", (m) => note("server", String(m.secondary || m.primary).slice(0, 44))],
    ["movement", (m) => note(m.phase, `→${fmt(m.target.x, 0)},${fmt(m.target.z, 0)} claims=${bot.movement?.stats?.claims}`)],
    ["spawn", (a) => note("spawn", `${fmt(a.x, 0)},${fmt(a.z, 0)}`)],
  ];
  for (const [e, fn] of subs) bot.on(e, fn);

  const ws = trace ? createWriteStream(trace, { flags: "a" }) : null;
  const timer = setInterval(() => {
    const w = bot.world, me = w?.me();
    const last = events.at(-1);
    const mv = bot.movement ? ` ${bot.movement.timer ? "🚶" : "·"} claims=${bot.movement.stats.claims} corr=${bot.movement.stats.corrections}` : "";
    out.write(`\x1b[2K\r\x1b[90m[${label}]\x1b[0m ${me ? `pos ${fmt(me.x)},${fmt(me.y)},${fmt(me.z)}` : "\x1b[33mlobby\x1b[0m"} | actors ${w?.actors.size ?? 0} humans ${w ? w.humans().length : 0} |${mv} | ${last ? last.name + ": " + last.brief : "…"}   `);
    if (ws) ws.write(JSON.stringify({ t: Date.now(), label, me: me && { x: me.x, y: me.y, z: me.z, health: me.health }, actors: w?.actors.size, events: events.slice(-5) }) + "\n");
  }, every);
  timer.unref?.();
  return () => { clearInterval(timer); for (const [e, fn] of subs) bot.removeListener(e, fn); ws?.end(); };
}
