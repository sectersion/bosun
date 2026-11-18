// protobuf schema layer over the game's own game.proto + MessageType enum.
import protobuf from "protobufjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = protobuf.loadSync(fileURLToPath(new URL("./game.proto", import.meta.url)));

/** MessageType enum name -> numeric id */
export const TYPE = JSON.parse(readFileSync(new URL("./msgtypes.json", import.meta.url), "utf8"));

// Enum names aren't always the proto message names ("Init" -> "InitMessage").
const lookup = (name) =>
  root.lookup(name) ? name : root.lookup(name + "Message") ? name + "Message" : null;

/** id -> { name, protoName } ; protoName null when no message exists for that enum entry */
export const BY_ID = new Map(
  Object.entries(TYPE).map(([name, id]) => [id, { name, protoName: lookup(name) }]),
);

export function encode(id, obj) {
  const e = BY_ID.get(id);
  if (!e?.protoName) throw new Error(`cannot encode type id ${id}`);
  const t = root.lookupType(e.protoName);
  return t.encode(t.fromObject(obj)).finish();
}

export function decode(id, bytes) {
  const e = BY_ID.get(id);
  if (!e?.protoName) return undefined; // unknown type — leave msg undefined
  const t = root.lookupType(e.protoName);
  return t.toObject(t.decode(bytes), { longs: Number, defaults: false });
}
