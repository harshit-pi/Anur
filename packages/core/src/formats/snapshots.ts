import { z } from "zod";
import { SnapshotHash } from "../ids.ts";
import { LineEnvelope } from "../jsonl/lines.ts";

/**
 * Snapshots are stored once by content hash in `snapshots/<hash>`, so a file
 * read in many threads takes space once (task 1.9). Deleting one writes a
 * tombstone to `snapshots/deleted/<device>.jsonl`, so every thread that used
 * it shows "snapshot deleted", on every device.
 */
export const TombstoneLine = LineEnvelope.extend({
  kind: z.literal("deleted"),
  hash: SnapshotHash,
  /** Why: a person deleting one, say for a secret, or Clean up removing unused ones. */
  reason: z.enum(["person", "cleanup"]),
});
export type TombstoneLine = z.infer<typeof TombstoneLine>;

/** Every hash a tombstone names, across devices. */
export function deletedHashes(lines: readonly TombstoneLine[]): Set<SnapshotHash> {
  return new Set(lines.map((l) => l.hash));
}
