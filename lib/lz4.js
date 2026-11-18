// Thin wrapper over lz4js — the exact library the game's vendors bundle uses.
// Note: lz4js treats the high bit of block size as "stored/uncompressed" (inverted vs the
// LZ4 spec); both ends of Salty Seas use lz4js so we must match it, not the spec.
import lz4js from "lz4js";

export function decompressFrame(raw) {
  const dst = lz4js.makeBuffer(lz4js.decompressBound(raw));
  const written = lz4js.decompressFrame(raw, dst);
  return new Uint8Array(dst.buffer ?? dst, dst.byteOffset ?? 0, written);
}
