# bosun

Unofficial Node.js client library + reverse-engineered protocol documentation for the
**[Salty Seas](https://saltyseas.io)** web game API — full binary WebSocket support:
handshake, LZ4 framing, XOR session keys, protobuf, clans, crews, friends, fleets.

> **Unofficial.** Not affiliated with, endorsed by, or connected to Salty Seas / yp3d.
> Everything here was derived from network observation and the publicly served JS bundle,
> for interoperability and research. No game assets or game code are distributed here
> (`game.proto` is a protocol schema with the original comments stripped). Use at your own
> risk; the developers can change or block any of this at any time.

## What works today (verified against live servers)

- Guest + persistent-account registration (email+password, no verification), rename, recovery
- Game socket: handshake, per-session 256-byte XOR key, LZ4 downlink, all 122 protobuf
  message types decoded
- Fleets: name N bots, group them into one crew (invite-token join), crew lifecycle
  (transfer / kick / leave)
- Clans: full lifecycle — create, search, join-request pipeline, officers, chat,
  announcements, leaderboards
- Friends: request/accept, block lists, player directory, map positions
  (direct messages: wire-complete, server-gated — see [`docs/friends.md`](docs/friends.md))
- Live coverage matrix: [`docs/coverage.md`](docs/coverage.md) — every status backed by a
  reproducible probe run

## Quickstart

```bash
cd lib && npm install && node demo.js --probe
```

```js
import { register, listServers, setName, GameClient } from "./lib/index.js";
import { Clans } from "./lib/clans.js";

const me = await register();                       // guest identity
await setName(me.id, "BosunBot");                  // ≤16 chars, no verification needed
const server = (await listServers(me.id)).sort((a, b) => a.playerCount - b.playerCount)[0];

const client = new GameClient({ id: me.id, server });
await client.connect();                            // handshake + XOR + LZ4, all handled
client.on("WorldMessage", (m) => console.log(m.index, m.tanks?.length, "actors"));

const clan = new Clans(client);
console.log((await clan.list()).listedClans?.length, "clans listed");
```

## Layout

| Path | Contents |
|---|---|
| `lib/` | the library (`index.js` core, `clans.js`/`friends.js` facades) + live probe scripts |
| `docs/` | protocol reference: connection flow, wire format, REST, architecture, clans, friends, coverage matrix, `game.proto` |

## Etiquette

These are real people's game servers. Probes here: least-populated servers only, ≤3 bots,
self-closing sockets, no chat spam, and rejections are recorded, not retried. If you build
on this, keep it that way — and note that bots with *active* positions or combat behavior at
scale is where "research" turns into "griefing."

## State / known gaps

`clientVersion` (`1158`) is baked into the bundle and breaks on each game redeploy (see
`docs/README.md` for the refresh recipe). Sailing physics are unresolved — the server
integrates ship movement, so naive position claims get rubber-banded. DM delivery and guest
chat are server-gated. Details per-type in `docs/coverage.md`.

## License

MIT (this repository's code and docs). The game itself, its assets, and its servers belong
to their owner.
