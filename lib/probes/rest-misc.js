// probes/rest-misc — remaining REST endpoints from docs/rest-api.md, exact shapes
// extracted from the shipped bundle (probes/_ref/chunk938.js, main.js).
// Client-faithful methods: flush=PUT, seen-ad=POST, signout=POST (docs guessed GET),
// user/reset=POST {email}, user/{register|login}=POST, signin/google={idToken},
// error=POST [retryCount,[[str,obj],...]] (boot) or [[str,obj],...] (runtime). All ?id= query.
import { register } from "../index.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HOST = "https://saltyseas.io/saltyseas-game";
const HEADERS = {
  origin: "https://saltyseas.io",
  referer: "https://saltyseas.io/app/",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/157.0.0.0",
};
const results = [];
const DEADLINE = Date.now() + 50_000;

async function call(label, method, path, body) {
  const rec = { label, method, url: HOST + path, status: null, allow: null, ct: null, body: null, error: null };
  if (Date.now() > DEADLINE) { rec.error = "skipped (deadline)"; results.push(rec); return rec; }
  const opts = { method, headers: { ...HEADERS }, credentials: "include", signal: AbortSignal.timeout(4000) };
  if (body !== undefined) { opts.headers["content-type"] = "application/json"; opts.body = JSON.stringify(body); }
  try {
    const r = await fetch(rec.url, opts);
    rec.status = r.status;
    rec.allow = r.headers.get("allow");
    rec.ct = r.headers.get("content-type");
    rec.body = (await r.text()).slice(0, 200_000);
  } catch (e) { rec.error = String(e?.cause?.message || e); }
  results.push(rec);
  console.log(`${label} -> ${rec.status ?? rec.error}${rec.allow ? ` [Allow: ${rec.allow}]` : ""} ${rec.body ? rec.body.slice(0, 140).replace(/\n/g, " ") : ""}`);
  return rec;
}

const me = await register();
const id = me.id;
console.log(`guest registered: ${id} (${me.username})`);
const q = `?id=${id}`;

// --- flush (real client: PUT, no body; docs guessed POST — probe all for 405 discovery)
await call("flush PUT (client method)", "PUT", `/api/me/flush/${q}`);
await call("flush POST (doc guess)", "POST", `/api/me/flush/${q}`);
await call("flush GET (405 discover)", "GET", `/api/me/flush/${q}`);

// --- seen-ad (real: POST no body)
await call("seen-ad POST (client method)", "POST", `/api/me/seen-ad/${q}`);
await call("seen-ad GET (405 discover)", "GET", `/api/me/seen-ad/${q}`);

// --- user lookup / reset (real paths: /api/user/<register|login>/?id=…, /api/user/reset/)
await call("user GET bare (doc guess)", "GET", `/api/user/${q}`);
await call("user POST bare dummy", "POST", `/api/user/${q}`, {});
await call("user login dummy (4xx shape)", "POST", `/api/user/login/${q}`, { email: "rest-misc-probe@invalid.example", password: "x" });
await call("user reset POST no-email", "POST", "/api/user/reset/", {});
await call("user reset GET (405 discover)", "GET", "/api/user/reset/");

// --- error reporting (boot shape [retryCount, [[tag,tag],[msg,msg]]] and runtime shape)
await call("error POST boot-shape", "POST", "/api/error/", [0, [["boot error", "rest-misc-probe"], ["probe message", "rest-misc-probe"]]]);
await call("error POST runtime-shape", "POST", "/api/error/", [["rest-misc-probe", "rest-misc-probe"]]);
await call("error GET (405 discover)", "GET", "/api/error/");

// --- signin providers, dummy tokens only
await call("signin google dummy idToken", "POST", `/api/signin/google/${q}`, { idToken: "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJyZXN0LW1pc2MtcHJvYmUifQ." });
await call("signin google GET (405)", "GET", `/api/signin/google/${q}`);
await call("signin microsoft dummy token", "POST", `/api/signin/microsoft/${q}`, { token: "rest-misc-probe-dummy" });
await call("signin crazygames dummy token", "POST", `/api/signin/crazygames/${q}`, { token: "rest-misc-probe-dummy" });

// --- signout (real client: POST; docs guessed GET) — probe GET first (expect 405), then POST, then verify id still alive
await call("signout GET (doc guess)", "GET", `/api/signout/${q}`);
await call("signout POST (client method)", "POST", `/api/signout/${q}`);
await call("me after signout (session check)", "GET", `/api/me/${q}`);

const out = fileURLToPath(new URL("./out", import.meta.url));
mkdirSync(out, { recursive: true });
const file = `${out}/rest-misc.json`;
writeFileSync(file, JSON.stringify({ guestId: id, username: me.username, at: new Date().toISOString(), results }, null, 1));
console.log(`saved ${results.length} results -> ${file}`);
process.exit(0);
