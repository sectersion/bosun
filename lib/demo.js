import { register, listServers, GameClient } from "./index.js";

const me = await register();
console.log("register ->", me);

if (process.argv[2] === "--probe") {
  const servers = await listServers(me.id);
  console.log("servers  ->", servers.map((s) => `${s.serverId}(${s.playerCount})`).join(" "));
  const g = new GameClient({ id: me.id, server: servers[0], clientVersion: Number(process.env.CLIENT_VERSION ?? 1158) });
  await g.connect();
  console.log("handshake OK — protocolKey", g.key.length, "bytes");
  let n = 0;
  g.on("message", ({ name, msg }) => {
    if (n++ < 10) console.log(name.padEnd(24), JSON.stringify(msg)?.slice(0, 160));
  });
  g.on("close", (e) => { console.log("closed", e); process.exit(0); });
  setTimeout(() => { g.close(); process.exit(n > 0 ? 0 : 1); }, 8000);
}
