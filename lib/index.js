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

export class GameClient extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.id            guest/account id from register()
   * @param {object} o.server        entry from listServers()
   * @param {number} o.clientVersion server-accepted client build (unknown constant — iterate)
   * @param {string} o.fingerprint   FingerprintJS-style visitor id sent post-handshake
   */
  constructor({ id, server, clientVersion = 1158, fingerprint = "a".repeat(32) }) {
    super();
    Object.assign(this, { id, server, clientVersion, fingerprint, key: null, ws: null });
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${this.server.websocketHost}?id=${encodeURIComponent(this.id)}`);
      this.ws.onmessage = async (ev) => {
        try {
          const buf =
            ev.data instanceof Blob ? new Uint8Array(await ev.data.arrayBuffer()) : new Uint8Array(ev.data);
          this._onFrame(buf, resolve, reject);
        } catch (e) { reject(e); this.emit("error", e); }
      };
      this.ws.onerror = () => reject(new Error("websocket error"));
      this.ws.onclose = (e) => this.emit("close", { code: e.code, reason: e.reason });
    });
  }

  _onFrame(raw, resolve, reject) {
    const o = decompressFrame(raw);
    if (!this.key) {
      // first frame: magic(8) + protocolKey(256), total 264
      if (o.length !== 264 || o.subarray(0, 8).join() !== HANDSHAKE_MAGIC.join()) {
        return reject(new Error(`unexpected handshake (${o.length} bytes)`));
      }
      this.key = o.subarray(8);
      this.send(TYPE.Init, { id: this.id, clientVersion: this.clientVersion, isCrazygames: false });
      resolve(this);
      setTimeout(() => {
        try { this.send(TYPE.LazyLoaderMessage, { id: this.fingerprint }); } catch {}
      }, 1240);
      return;
    }
    const id = o[0];
    const entry = BY_ID.get(id);
    let msg;
    try { msg = decode(id, o.subarray(1)); } catch (e) { return this.emit("error", e); }
    const name = entry?.name ?? `#${id}`;
    this.emit("message", { id, name, msg });
    this.emit(name, msg);
  }

  /** send(nameOrId, payload) — e.g. send("MyTankMessage", { id, x, y, z, interpolationIndex: 0 }) */
  send(nameOrId, obj) {
    const id = typeof nameOrId === "number" ? nameOrId : TYPE[nameOrId];
    if (id === undefined) throw new Error(`unknown message ${nameOrId}`);
    if (!this.key) throw new Error("not connected (no protocolKey yet)");
    const body = encode(id, obj);
    const frame = xor(new Uint8Array([id, ...body]), this.key);
    this.ws.send(frame);
    return id;
  }

  close() { this.ws?.close(); }
}
