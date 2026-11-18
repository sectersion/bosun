// Salty Seas API client — REST + game WebSocket. Requires Node >= 22 (global WebSocket).
import { EventEmitter } from "node:events";
import { decompressFrame } from "./lz4.js";
import { TYPE, BY_ID, encode, decode } from "./proto.js";

export { TYPE };

const HOST = "https://saltyseas.io/saltyseas-game";
const HEADERS = {
  origin: "https://saltyseas.io",
  referer: "https://saltyseas.io/app/",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/157.0.0.0",
};

async function api(path, id, opts = {}) {
  const url = new URL(HOST + path);
  if (id) url.searchParams.set("id", id);
  const r = await fetch(url, { headers: HEADERS, ...opts });
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
  return r.json();
}

// ---- REST (see docs/rest-api.md) ----

/** Create (or fetch) the guest identity. No id yet — the server assigns one. */
export const register = () => api("/api/me/");
export const profile = (id) => api("/api/me/", id);
/** Rename: PATCH api/me/ — what the username box on the connect screen calls. Returns updated profile. */
export const setName = (id, username) =>
  api("/api/me/", id, {
    method: "PATCH",
    headers: { ...HEADERS, "content-type": "application/json" },
    body: JSON.stringify({ username }),
  });
export const listServers = (id) => api("/api/list-servers/", id);
export const getServerConfig = (id) => api("/api/me/config/", id);
export const getKeyMapping = (id) => api("/api/me/key-mapping/v2/", id);
export const serverTime = () => api("/api/time/");
/** Bind an email+password to THIS session id (no verification, format unchecked, pw ≥6). Returns profile (same id). */
export const registerAccount = (id, email, password) =>
  api("/api/user/register/", id, { method: "POST", headers: { ...HEADERS, "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
/** Recover a registered account. Pass a fresh/throwaway session id as `id`; the response `id` is the canonical account id. */
export const login = (id, email, password) =>
  api("/api/user/login/", id, { method: "POST", headers: { ...HEADERS, "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
// Verified: PATCH /api/me/ rename via setName() above.
// Unverified (present in bundle, semantics not yet probed): /api/me/equip/ /api/me/flush/
// /api/me/seen-ad/ /api/error/ /api/signin/google|microsoft|crazygames/ /api/signout/
// /api/user/ /api/user/reset/

// ---- game socket ----

const HANDSHAKE_MAGIC = [13, 14, 10, 13, 11, 14, 14, 15];
const xor = (b, key) => b.map((x, i) => x ^ key[i % key.length]);
const APP_HTML = "https://saltyseas.io/app/";
const CDN = "https://cdn.saltyseas.io/app/";

/** Version-drift armor: read the live 938 chunk's client build number (the `L=` constant). */
export async function currentVersion() {
  const html = await (await fetch(APP_HTML, { headers: HEADERS })).text();
  const mainHash = html.match(/main\.([a-f0-9]+)\.js/)?.[1];
  if (!mainHash) throw new Error("no main.js in /app/");
  const main = await (await fetch(CDN + "main." + mainHash + ".js", { headers: HEADERS })).text();
  const chunkHash = main.match(/938:"([a-f0-9]+)"/)?.[1];
  if (!chunkHash) throw new Error("no 938 chunk in main.js");
  const chunk = await (await fetch(CDN + "938." + chunkHash + ".js", { headers: HEADERS })).text();
  const v = chunk.match(/[,;(]L=(\d{3,6}),D=/)?.[1] ?? chunk.match(/[,;(]L=(\d{3,6})/)?.[1];
  if (!v) throw new Error("no L= version in 938 chunk");
  return Number(v);
}

// DisconnectReason codes that must NOT auto-reconnect (see docs). 7 (oldClientVersion) is
// special-cased: refresh the version, then reconnect.
const NO_RECONNECT = new Set([0, 2, 9, 10, 14]); // openInAnotherTab, banned, suspectedHacking, kicked, BannedFromMainServers

export class GameClient extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.id            guest/account id from register()
   * @param {object} o.server        entry from listServers()
   * @param {number} o.clientVersion server-accepted client build (see currentVersion(); default = last known-good)
   * @param {string} o.fingerprint   FingerprintJS-style visitor id sent post-handshake
   * @param {boolean} o.autoReconnect  reconnect on transient drops (default true)
   */
  constructor({ id, server, clientVersion = 1158, fingerprint = "a".repeat(32), autoReconnect = true, maxReconnectDelay = 30000 }) {
    super();
    Object.assign(this, {
      id, server, clientVersion, fingerprint, autoReconnect, maxReconnectDelay,
      key: null, ws: null, connected: false,
      _closed: false, _attempt: 0, _reconnecting: false, _noReconnect: false,
      _hr: null, _rj: null,
    });
  }

  connect() { this._closed = false; this._noReconnect = false; return this._open(); }

  _open() {
    return new Promise((resolve, reject) => {
      this._hr = resolve; this._rj = reject;
      const ws = new WebSocket(`${this.server.websocketHost}?id=${encodeURIComponent(this.id)}`);
      this.ws = ws;
      ws.onmessage = async (ev) => {
        try {
          const buf = ev.data instanceof Blob ? new Uint8Array(await ev.data.arrayBuffer()) : new Uint8Array(ev.data);
          this._onFrame(buf);
        } catch (e) { this.emit("error", e); this._rj?.(e); }
      };
      ws.onerror = () => {}; // a following onclose drives recovery
      ws.onopen = () => { this._attempt = 0; };
      ws.onclose = (e) => this._handleClose(e);
    });
  }

  _onFrame(raw) {
    const o = decompressFrame(raw);
    if (!this.key) {
      if (o.length !== 264 || o.subarray(0, 8).join() !== HANDSHAKE_MAGIC.join()) {
        return this._rj?.(new Error(`unexpected handshake (${o.length} bytes)`));
      }
      this.key = o.subarray(8);
      this.connected = true;
      this._sendRaw(TYPE.Init, { id: this.id, clientVersion: this.clientVersion, isCrazygames: false });
      const wasReconnect = this._reconnecting;
      this._reconnecting = false;
      this._hr?.(this);
      this.emit(wasReconnect ? "reconnect" : "connect");
      setTimeout(() => { try { this._sendRaw(TYPE.LazyLoaderMessage, { id: this.fingerprint }); } catch {} }, 1240);
      return;
    }
    const id = o[0];
    const entry = BY_ID.get(id);
    let msg;
    try { msg = decode(id, o.subarray(1)); } catch (e) { return this.emit("error", e); }
    const name = entry?.name ?? `#${id}`;
    // drive reconnect policy from DisconnectReason before dispatching
    if (id === TYPE.DisconnectReason) this._onDisconnectReason(msg);
    this.emit("message", { id, name, msg });
    this.emit(name, msg);
  }

  _onDisconnectReason(msg) {
    const reason = msg?.reason;
    if (reason === 7) { // oldClientVersion → self-heal the version, then allow reconnect
      this._versionStale = true;
      return; // do NOT set _noReconnect; reconnect with refreshed version
    }
    if (NO_RECONNECT.has(reason)) this._noReconnect = true;
    this.emit("disconnectReason", reason);
  }

  _handleClose(e) {
    this.key = null; this.connected = false; // a new handshake yields a new protocolKey
    const intentional = this._closed;
    if (intentional || !this.autoReconnect || (this._noReconnect && !this._versionStale)) {
      this.emit("close", { code: e.code, reason: e.reason, intentional });
      return;
    }
    this._reconnecting = true;
    const delay = Math.min(1000 * 2 ** this._attempt, this.maxReconnectDelay) + Math.floor(Math.random() * 400);
    this._attempt++;
    const bump = async () => {
      if (this._versionStale) {
        try { const v = await currentVersion(); if (v !== this.clientVersion) { this.clientVersion = v; this.emit("versionRefreshed", v); } } catch {}
        this._versionStale = false;
      }
    };
    this.emit("reconnecting", { attempt: this._attempt, delay, code: e.code });
    setTimeout(() => { if (!this._closed) bump().then(() => this._open().catch((err) => this.emit("error", err))); }, delay);
  }

  _sendRaw(id, obj) {
    if (!this.key) throw new Error("not connected");
    const body = encode(id, obj);
    this.ws.send(xor(new Uint8Array([id, ...body]), this.key));
  }

  /** send(nameOrId, payload) — throws if not connected. Verbs should guard on client.connected. */
  send(nameOrId, obj) {
    const id = typeof nameOrId === "number" ? nameOrId : TYPE[nameOrId];
    if (id === undefined) throw new Error(`unknown message ${nameOrId}`);
    this._sendRaw(id, obj);
    return id;
  }

  close() { this._closed = true; this.ws?.close(); }
}
