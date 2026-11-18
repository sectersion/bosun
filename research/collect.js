// Passive capture collector: page hooks POST JSONL frames here; we append to disk.
// Run: node collect.js <outfile>   (listens on 127.0.0.1:8790)
const { createServer } = require("node:http");
const { appendFileSync, existsSync, readFileSync } = require("node:fs");

const OUT = process.argv[2] || "capture-1.jsonl";
createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.end(); return; }
  if (req.method === "POST") {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => { appendFileSync(OUT, b + "\n"); console.log("+" + b.split("\n").length); res.end("ok"); });
    return;
  }
  const n = existsSync(OUT) ? readFileSync(OUT, "utf8").trim().split("\n").length : 0;
  res.end("alive " + OUT + " " + n);
}).listen(8790, "127.0.0.1", () => console.log("collector :8790 -> " + OUT));
