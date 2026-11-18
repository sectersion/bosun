// Offline tests for WorldModel — synthetic semantics + recorded-fixture replay.
// run: node test-world.js
import { readFileSync, existsSync } from "node:fs";
import { WorldModel } from "./world.js";

let pass = 0;
const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); process.exit(1); } pass++; };

// ---------- synthetic ----------
{
  const w = new WorldModel();
  let gone = 0, appeared = 0, moved = 0;
  w.on("actorGone", () => gone++); w.on("actorAppear", () => appeared++); w.on("actorMoved", () => moved++);

  w.apply("WorldMessage", { index: 1, isFullState: true, tanks: [
    { id: 10, username: "alice", x: 0, y: 1, z: 0, health: 100, classification: 0 },
    { id: 20, username: "bob", x: 5, y: 1, z: 5, health: 80, classification: 0 },
    { id: 30, x: 500, y: 0, z: 500, classification: 4 },
  ]});
  ok(w.actors.size === 3 && appeared === 3, "full state seeds registry");
  ok(w.islands().length === 1, "island classification");

  w.apply("WorldMessage", { index: 2, tanks: [{ id: 10, x: 1 }] });
  const alice = w.byId(10);
  ok(alice.x === 1 && alice.username === "alice" && alice.health === 100, "delta merges, preserves untouched fields");
  ok(moved === 1, "actorMoved only on position change");

  w.apply("WorldMessage", { index: 3, tanks: [{ id: 20 }], actorsToRemove: [30] });
  ok(w.byId(20) && !w.byId(30) && gone === 1, "actorsToRemove despawns");

  w.apply("WorldMessage", { index: 4, isFullState: true, tanks: [{ id: 99, username: "zoe", x: 0, y: 0, z: 0 }] });
  ok(w.actors.size === 1 && gone === 3, "full-state replacement despawns the missing (alice+bob)");

  w.apply("ResetYourState", { yourTank: { id: 99, username: "zoe", x: 1, y: 2, z: 3 } });
  ok(w.me()?.username === "zoe", "ResetYourState binds me()");

  w.apply("WorldMessage", { index: 5, tanks: [{ id: 7, x: 100, y: 0, z: 50, passengerIds: { ids: [8] } }, { id: 8, x: -0.5, y: 1, z: 0, relativeToId: 7 }] });
  const rider = w.positionOf(w.byId(8));
  ok(Math.abs(rider.x - 99.5) < 1e-6 && Math.abs(rider.z - 50) < 1e-6, "vehicle-relative chain resolves");
  ok(w.vessels().length === 1, "vessel heuristic via passenger manifest");

  w.apply("ChatMessage", { username: "alice", message: "hi" });
  w.apply("ScoresMessage", { scores: [], playersOnline: 42 });
  w.apply("WorldMessage", { index: 6, tanks: [], changingDetails: { gold: 12.5, level: 3 } });
  ok(w.self.gold === 12.5 && w.self.level === 3, "changingDetails accumulate");
}

// ---------- fixture replay ----------
const FIX = "fixtures/session-90s.jsonl";
if (existsSync(FIX)) {
  const w = new WorldModel();
  const lines = readFileSync(FIX, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  let ticks = 0, moves = 0, maxActors = 0;
  w.on("tick", () => ticks++);
  w.on("actorMoved", (a) => { moves++; if (a.id === w.meId) 0; });
  let mePath = 0, lastMe = null;
  w.on("actorMoved", (a) => { if (w.meId && a.id === w.meId) { if (lastMe) mePath += Math.hypot(a.x - lastMe.x, a.z - lastMe.z); lastMe = { x: a.x, z: a.z }; } });
  for (const f of lines) { w.apply(f.name, f.m); maxActors = Math.max(maxActors, w.actors.size); }
  ok(ticks > 100, `fixture: ${ticks} ticks replayed`);
  ok(maxActors > 50, `fixture: registry peaked at ${maxActors} actors`);
  ok(w.me(), "fixture: me() present after ResetYourState");
  ok(mePath > 30, `fixture: self walked/sailed ${mePath.toFixed(0)} world units`);
  ok(w.index > 0 && w.mapSize != null, `fixture: index=${w.index} mapSize=${w.mapSize}`);
  console.log(`fixture replay: ${lines.length} msgs | ${ticks} ticks | ${maxActors} peak actors | self path ${mePath.toFixed(0)}u | humans now ${w.humans().length}`);
} else console.log("(fixture missing — synthetic tests only)");

console.log(`ALL ${pass} ASSERTIONS PASS`);
