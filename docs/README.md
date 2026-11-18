# Salty Seas — Reverse-Engineered API Notes

Unofficial documentation of the [Salty Seas](https://saltyseas.io) web game protocol, captured
2026-11-16 via DevTools (guest session, server 1).

- Client: `https://saltyseas.io/app/` — webpack bundle `main.1133f388.js` + game chunk `938.37e37b79.js` (CDN: `cdn.saltyseas.io/app/`)
- Engine stack: React + PixiJS + FingerprintJS (vendors), game logic in chunk 938
- Everything in these docs was observed from live traffic or extracted from the shipped JS.

| File | Contents |
|---|---|
| [`architecture.md`](architecture.md) | Client/server split, tick loop, notable engineering, custom-client feasibility |
| [`rest-api.md`](rest-api.md) | HTTP endpoints, guest identity, server list |
| [`websocket.md`](websocket.md) | Game-server protocol: LZ4 framing, handshake, XOR mask, message-type table |
| [`game.proto`](game.proto) | Complete protobuf schema (122 messages) extracted verbatim from the bundle |
| [`msgtypes.json`](msgtypes.json) | MessageType numeric enum (69 entries) |
| [`coverage.md`](coverage.md) | Full API coverage matrix: every WS type + REST endpoint, verified status, reproduce steps |
| [`clans.md`](clans.md) | Clan system deep-dive: the one-message/one-verb protocol, ack patterns, fleet automation recipe |
| [`friends.md`](friends.md) | Friends & DM subsystem: request/accept semantics, block-is-destructive, verified DM block |

## TL;DR connection flow

1. `GET https://saltyseas.io/saltyseas-game/api/me/` → creates guest account, sets `yp3dUserId` cookie, returns `{"id":"Kz1nXXUqRdY","username":"guest_199126",...}`
2. `GET /saltyseas-game/api/list-servers/` → per-server `apiHost` + `websocketHost`
3. `wss://api-eu-1.saltyseas.io/saltyseas-game/server-1?id=<userId>`
4. Server sends handshake: **LZ4 frame** whose payload is 8 magic bytes + 256-byte `protocolKey`
5. Client XORs every outgoing frame (`[u8 messageType][protobuf]`) with that key, cyclically
6. Server→client frames are LZ4-wrapped `[u8 messageType][protobuf]`; see `game.proto`

## Verification status

Confirmed end-to-end via `lib/` (Node): guest register + rename (`PATCH api/me/`),
server discovery, WS handshake (LZ4 via **lz4js** — its block flag is inverted vs the LZ4
spec, both ends of the game use it), 256-byte XOR key, `clientVersion=1158`, live tick decode
of all schema types, crew grouping (invite-token join + request/accept with the
"accept requests" checkbox). `InitMessage` type id = 0 (`Init` enum entry).

Resolved since (see [`coverage.md`](coverage.md)): per-server REST is real (`PUT /me/flush/`
verified on `apiHost`); signin endpoints are reachable but only their validation chains
(401/400) — success flows still open; position-claim movement is NOT relayed for fresh
guest clients (server rubber-bands everything — the "client-authoritative" model needs a
real ship spawn, see movement domain). Still open: Xsolla payments, chat with registered
accounts, trader purchases, PvP out of safe zones.

## Coverage snapshot (2026-11-17)

Full matrix with per-type status + evidence: [`coverage.md`](coverage.md). Statuses reflect
adversarial verification re-runs (silence is not counted as exercise; verifier overrides
implementer claims where they disagreed).

- Protobuf schema: **100%** — all 122 messages / 69 types encode+decode generically
- WS types (69): **36 exercised · 8 exercised-with-rejection · 8 blocked · 17 not-exercised**
- REST (22 rows): **10 exercised · 7 exercised-with-rejection (405/404/400/401) · 3 blocked · 2 not-exercised**
- Verified end-to-end by rerun: **crews, config sync, REST misc**
- Blocked domains: synthetic-client movement relay, PvP combat (spawn safe zones), item
  pickup success, trader shop purchases, chat (guest-gated), spectators (admin-gated),
  death/gib/respawn-dialogue chain, bots, paid weapons/ammo, Xsolla payments
