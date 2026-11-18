// render.js — turn a WorldModel into an SVG top-down snapshot: what the bot sees.
// Pure/string output, no deps; for terminal use the inspector, for visual use toSVG().
import { WorldModel } from "./world.js";

const CLS = ["#e8543f", "#8a8f98", "#8a8f98", "#c9a227", "#3f7d5a", "#8a8f98", "#4a90d9"]; // by classification
const SIZE = 640, MARGIN = 24;

/**
 * @param {WorldModel} world
 * @param {object} o { range (world units across), center {x,z}, trail?: [{x,z}] }
 */
export function toSVG(world, { range = 120, center, trail } = {}) {
  const me = world.me();
  const c = center ?? (me ? world.positionOf(me) : { x: 0, z: 0 });
  const scale = (SIZE - 2 * MARGIN) / range;
  const X = (x) => MARGIN + (x - c.x) * scale + (SIZE - 2 * MARGIN) / 2;
  const Z = (z) => MARGIN + (z - c.z) * scale + (SIZE - 2 * MARGIN) / 2;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}"><rect width="${SIZE}" height="${SIZE}" fill="#0b1220"/>`;
  s += `<g opacity="0.5" stroke="#1e2b3a">`;
  for (let g = -Math.ceil(range / 2); g <= range / 2; g += 20) {
    s += `<line x1="${X(c.x + g)}" y1="${MARGIN}" x2="${X(c.x + g)}" y2="${SIZE - MARGIN}"/>`;
    s += `<line x1="${MARGIN}" y1="${Z(c.z + g)}" x2="${SIZE - MARGIN}" y2="${Z(c.z + g)}"/>`;
  }
  s += `</g>`;
  // islands (classification 4) as blobs
  for (const a of world.select((a) => a.classification === 4)) {
    const p = world.positionOf(a);
    const r = (a.scale ?? 8) * scale;
    s += `<circle cx="${X(p.x).toFixed(0)}" cy="${Z(p.z).toFixed(0)}" r="${r.toFixed(0)}" fill="#15352a" stroke="#2f6b4f" stroke-width="1"/>`;
  }
  if (trail?.length)
    s += `<polyline fill="none" stroke="#f4d35e" stroke-width="1.5" opacity="0.8" points="${trail.map((t) => `${X(t.x).toFixed(0)},${Z(t.z).toFixed(0)}`).join(" ")}"/>`;
  // actors
  for (const a of world.select((a) => a.id !== world.meId)) {
    const p = world.positionOf(a);
    if (p.x < c.x - range / 2 || p.x > c.x + range / 2 || p.z < c.z - range / 2 || p.z > c.z + range / 2) continue;
    const col = CLS[a.classification ?? 0] ?? "#8a8f98";
    const isShip = (a.passengerIds?.ids?.length ?? 0) > 0;
    if (isShip) s += `<rect x="${(X(p.x) - 4).toFixed(0)}" y="${(Z(p.z) - 2).toFixed(0)}" width="8" height="4" fill="${col}" opacity="0.85"/>`;
    else s += `<circle cx="${X(p.x).toFixed(0)}" cy="${Z(p.z).toFixed(0)}" r="2.6" fill="${col}" opacity="0.85"/>`;
    if (a.gid && a.username) s += `<text x="${(X(p.x) + 4).toFixed(0)}" y="${(Z(p.z) - 3).toFixed(0)}" fill="#7d8aa0" font-size="8" font-family="monospace">${esc(a.username)}</text>`;
  }
  // me + heading
  if (me) {
    const p = world.positionOf(me);
    const hx = p.x + Math.sin(me.rotationY || 0) * 6, hz = p.z + Math.cos(me.rotationY || 0) * 6;
    s += `<line x1="${X(p.x)}" y1="${Z(p.z)}" x2="${X(hx)}" y2="${Z(hz)}" stroke="#f4d35e" stroke-width="2"/>`;
    s += `<circle cx="${X(p.x).toFixed(0)}" cy="${Z(p.z).toFixed(0)}" r="4" fill="#f4d35e" stroke="#fff" stroke-width="1"/>`;
    if (me.health != null) s += `<text x="${X(p.x) + 6}" y="${Z(p.z) + 10}" fill="#f4d35e" font-size="8" font-family="monospace">hp${me.health.toFixed(0)}</text>`;
  }
  // legend + scale bar
  s += `<text x="${MARGIN}" y="16" fill="#7d8aa0" font-size="10" font-family="monospace">bosun · ${world.actors.size} actors · idx ${world.index} · map ${world.mapSize} · ${range}u view</text>`;
  s += `<line x1="${SIZE - MARGIN - 20 * scale}" y1="${SIZE - 12}" x2="${SIZE - MARGIN}" y2="${SIZE - 12}" stroke="#7d8aa0"/><text x="${SIZE - MARGIN - 20 * scale}" y="${SIZE - 16}" fill="#7d8aa0" font-size="8" font-family="monospace">20u</text>`;
  s += `</svg>`;
  return s;
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** replay a recorded fixture (from analyze.mjs) into a fresh WorldModel up to a point */
export async function worldFromReplay(file, { upto = Infinity, filter } = {}) {
  const { readFileSync } = await import("node:fs");
  const w = new WorldModel();
  const trail = [];
  const lines = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  let last = -Infinity;
  for (const f of lines) {
    if (f.dir !== "d") continue;
    if (upto !== Infinity && f.t > upto) break;
    w.apply(f.name, f.m);
    if (w.meId && f.name === "WorldMessage" && f.m.tanks?.some((t) => t.id === w.meId)) {
      const me = w.me(); if (me?.x != null && (!filter || filter())) trail.push({ x: me.x, z: me.z });
    }
  }
  return { world: w, trail };
}
