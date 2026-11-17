import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

/**
 * Minting IDs from content, the same way on every device (Data Model,
 * "Keeping section IDs stable"): an ID is a hash of what it names. A hash
 * that is already taken, by a live or an orphaned record, is hashed again
 * together with the ID that holds it, so every device computes the same new
 * ID and an old record's history never attaches to a newcomer.
 */

/** 16 hex characters of SHA-256: 64 bits, safe as a file name. */
export function hashId(parts: readonly string[]): string {
  return bytesToHex(sha256(utf8ToBytes(parts.join("\u0000")))).slice(0, 16);
}

export function mintId(parts: readonly string[], isTaken: (id: string) => boolean): string {
  let id = hashId(parts);
  for (let i = 0; isTaken(id); i++) {
    if (i > 1000) throw new Error("mintId: no free ID after 1000 tries");
    id = hashId([...parts, id]);
  }
  return id;
}
