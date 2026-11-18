// Bot — WorldModel wired to a live GameClient, plus the first verbs.
// import { createBot } from "./bot.js";
import { EventEmitter } from "node:events";
import { GameClient } from "./index.js";
import { WorldModel } from "./world.js";
import { Walker } from "./movement.js";
import { Helmsman } from "./sail.js";

const FORWARD = ["spawn", "tick", "actorAppear", "actorGone", "actorMoved", "chat", "event", "explosion", "damage", "scores", "crew"];

export class Bot extends EventEmitter {
  constructor(client) {
    super();
    this.client = client;
    this.world = new WorldModel();
    this.movement = new Walker(this);
    this.helmsman = new Helmsman(this);
    client.on("message", ({ name, msg }) => this.world.apply(name, msg));
    for (const e of FORWARD) this.world.on(e, (...a) => this.emit(e, ...a));
    this.world.on("movement", (m) => this.emit("movement", m));
    this.world.on("sailing", (m) => this.emit("sailing", m));
  }

  /** id: account id (see register()/login() in index.js); server: entry from listServers() */
  static async create({ id, server }) {
    const client = new GameClient({ id, server });
    const bot = new Bot(client);
    await client.connect();
    return bot;
  }

  get me() { return this.world.me(); }
  spawn(location = 1) { this.client.send("RequestRespawnMessage", { location }); } // 0 havana 1 port 2 yourShip 3 jungle
  chat(message, group = false) { this.client.send("MyChatMessage", { isGroup: group, message }); }
  /** walk on foot toward {x,z} (world frame); resolves {pos} on arrival. Land/walk only for now. */
  walkTo(target, opts) { return this.movement.walkTo(target, opts); }
  stopWalk() { this.movement.stop(); }
  /** sail the vessel we're aboard toward world {x,z}; rudder = our yaw (lib/sail.js model) */
  sailTo(target) { return this.helmsman.sailTo(target); }
  stopSail() { this.helmsman.stop(); }
  close() { this.movement.stop(); this.helmsman.stop(); this.client.close(); }
}

export const createBot = (...args) => Bot.create(...args);
