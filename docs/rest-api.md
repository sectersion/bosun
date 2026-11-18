# REST API

Base: `https://saltyseas.io/saltyseas-game/api/` (front proxy: openresty; **app backend is
drogon/1.9.11** — its 404 HTML pages prove it. CORS allows `Content-Type, Authorization`,
credentials).

## Identity model

Two equivalent ways the API identifies a client:

- **Cookie** `yp3dUserId` / `yp3dUserIdGlobal` — set by `GET api/me/` on first visit (1-year expiry, HttpOnly, `SameSite=None; Secure`)
- **Query param** `?id=<userId>` — used by the game client on every call, e.g. `?id=Kz1nXXUqRdY`

Verified 2026-11-17: **only the `?id=` query form is routed** — the docs' earlier
path-param notation (`/me/flush/<id>`, `/signin/google/<id>`) 404s; the bundle helper
emits `?id=<userId>` after the trailing slash on every call. Also security-relevant:
`POST /signout/` rotates the *cookie* to a brand-new guest but does **not** invalidate the
old `?id=` — `GET /me/?id=old` keeps working after signout.

Guest accounts are auto-created with username `guest_<number>`. The id format (11 chars) also appears as a `tanks-3d:` localStorage key family in the client.

## Endpoints

Extracted from the game bundle + verified live by probes 2026-11-17 (all under the base
above, `?id=`-style). ✔ = observed live. 405 responses have an **empty body and no
`Allow` header** — method discovery must be per-endpoint.

| Endpoint | Purpose / notes |
|---|---|
| `GET /time/` ✔ | server clock — `{"time":"…Z"}` ISO-ms, no id needed |
| `GET /me/` ✔ | profile + create-or-get guest identity; response below |
| `PATCH /me/?id=` ✔ | **rename** — body `{"username":"..."}`; ≤16 chars (silently truncated), spaces + alphanumerics allowed, server does NOT block `guest_` prefixes (client-side check only); new name propagates to `ResetYourState.yourTank.username`, crew members, world. Unknown fields (e.g. `config`) silently ignored — it does not double as a config write. |
| `GET /me/config/?id=` ✔ | client config blob (21 keys; incl. `chosenRespawnLocation` — respawn location is synced client config; config `graphicsMode` is a distinct field from the profile's) |
| `PUT /me/config/?id=` ✔ | **partial-merge** write: PUT `{viewTypeOffset:7}` persisted, other 20 keys intact; response = full stored blob. POST/PATCH → 405. |
| `GET /me/key-mapping/v2/?id=` ✔ | control scheme, 23 keys (field name is `backwards`, not `back`) |
| `GET /me/equip/<id>` | 404 — path-form ids unrouted; equip state is socket-only (`ResetYourState.equipment`) |
| `PUT /me/flush/?id=` ✔ | persist local state — **PUT, not POST** (POST/GET → 405); returns full profile; works on per-server `apiHost` too |
| `POST /me/seen-ad/` | **dead route** — 404 on main AND `api-eu-1` hosts despite the shipped bundle calling it |
| `GET /list-servers/` ✔ | game server list, response below |
| `POST /error/` ✔ | open client-error ingest: any JSON array → `{"ok":true}`, no auth (GET → 405) |
| `POST /signin/google/?id=` | rejected without valid JWT: 401 `{"errorMessage":"Invalid Google ID token: JWT processing error: claim not found"}` (alg:none fails) |
| `POST /signin/microsoft/?id=` | validation chain: 400 "publisherPlayerId is required" → "signature is required" (body is MSAL playerInfo) |
| `POST /signin/crazygames/?id=` | 401 "Invalid CrazyGames token: … invalid token supplied" |
| `POST /signout/?id=` ✔ | **POST, not GET** (GET → 405); returns a NEW guest profile; old `?id=` remains usable (not invalidated) |
| `GET/POST /user/` | 404 — only `/user/<register|login>/?id=` routed; login with dummy creds → 400 `{"errorMessage":"User not found"}` |
| `POST /user/reset/` | **dead route** — 404 (main + EU hosts) despite bundle calling it |

Error envelope is `{"errorMessage":"…"}`; signin success is `{"success":<profile>}` (bundle
handling). Payments go through **Xsolla** (`https://secure.xsolla.com/paystation4/`, prod
flag in client config) — untouched by probes.

### `GET /me/` — observed response (guest)

```json
{"canSpectate":false,"equipped":[],"gold":0.0,"graphicsMode":0,"id":"Kz1nXXUqRdY",
 "lastSeenAd":"1970-01-01T00:00:00.000000Z","level":1.0,
 "now":"2026-11-16T23:34:33.980863Z","selectedCharacterMesh":null,"selectedShip":null,
 "selectedSkin":null,"tutorialsSeen":{},"username":"guest_199126"}
```

### `GET /list-servers/` — observed response (2026-11-16)

```json
[
 {"serverId":1,"serverName":"Server 1","playerCount":232,"maxPlayerCount":250,"version":1,
  "apiHost":"https://api-eu-1.saltyseas.io/saltyseas-game/server-1",
  "websocketHost":"wss://api-eu-1.saltyseas.io/saltyseas-game/server-1"},
 {"serverId":2,"apiHost":"https://api-eu-1.saltyseas.io/saltyseas-game/server-2","maxPlayerCount":250,"playerCount":121,"version":1,"websocketHost":"wss://api-eu-1.saltyseas.io/saltyseas-game/server-2"},
 {"serverId":3,"...":"(servers 3–5 identical shape)"},
 {"serverId":5,"playerCount":11,"maxPlayerCount":250}
]
```

All five servers currently on one region host (`api-eu-1`). The per-server REST namespace
is **real** — `PUT /api/me/flush/` verified live on `api-eu-1…/server-N` (2026-11-17).

## Embedded client config

The bundle ships a debug-config module (`main.js` module `11634`), the server presumably mirrors this:

```js
{ host:"https://saltyseas.io", quickJoin:false, mapSize:500, mapSizeFactor:1,
  islandDistance:90, botCount:0, timeBeforeFirstRound:15, roundLength:1500,
  playerTimeout:420, swimmingSpeed:1.1, shipSpeed:?, crosshairMaxRange:300,
  isXsollaProd:true, xsollaPayments:"https://secure.xsolla.com/paystation4/",
  skinsLevelRequired:true, l:2000, ll:true, requestFullScreen:true, ... }
```

**DOC CORRECTION (verified 2026-11-17):** `roundLength`/`playerTimeout` do **not** arrive
over the socket — `game.proto`'s `ServerConstantsMessage(19)` has no such fields
(only `cannonBallProps`/`tankStats`/`islands`/`characterMeshUnlocks`/`mapLandmarks`) and
three live decodes confirm absence. Round timing appears to exist only in the bundle
debug-config module above. Runtime `mapSize` from `ResetYourState` is **1700** — the
embedded `mapSize:500` above is stale.
