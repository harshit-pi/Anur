import { createHash } from "node:crypto";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { SnapshotHash, TombstoneLine, anurPaths, deletedHashes, mergeLines } from "@anur/core";
import { writeFileAtomic } from "./anur-folder.ts";
import { JsonlWriter, readJsonlFile } from "./jsonl-writer.ts";
import { readFile } from "./anur-copy.ts";

export function hashOf(bytes: Uint8Array): SnapshotHash {
  return SnapshotHash.parse(createHash("sha256").update(bytes).digest("hex"));
}

/**
 * Snapshots in `.anur/snapshots/`, stored once by the SHA-256 of their bytes.
 * Deleting one removes its file at once and writes a tombstone, so threads
 * that used it show "snapshot deleted" on every device.
 */
export class SnapshotStore {
  constructor(
    private readonly anurDir: string,
    private readonly device: string,
  ) {}

  private file(hash: SnapshotHash) {
    return path.join(this.anurDir, anurPaths.snapshot(hash));
  }

  /** Store bytes, once; returns their hash. */
  async put(bytes: Uint8Array): Promise<SnapshotHash> {
    const hash = hashOf(bytes);
    const file = this.file(hash);
    try {
      await stat(file);
      return hash;
    } catch {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFileAtomic(file, bytes);
      return hash;
    }
  }

  /** The bytes, or null when the snapshot was deleted or never arrived. */
  async get(hash: SnapshotHash): Promise<Uint8Array | null> {
    try {
      const bytes = await readFile(this.file(hash));
      return hashOf(bytes) === hash ? bytes : null;
    } catch {
      return null;
    }
  }

  async delete(hash: SnapshotHash, reason: "person" | "cleanup"): Promise<void> {
    await rm(this.file(hash), { force: true });
    const w = await JsonlWriter.open(
      path.join(this.anurDir, anurPaths.deletedSnapshots(this.device)),
      this.device,
    );
    try {
      await w.append({ kind: "deleted", hash, reason });
    } finally {
      await w.close();
    }
  }

  /** Every hash any device has deleted. */
  async deleted(): Promise<Set<SnapshotHash>> {
    const dir = path.join(this.anurDir, path.dirname(anurPaths.deletedSnapshots(this.device)));
    let names: string[];
    try {
      names = (await readdir(dir)).filter((n) => n.endsWith(".jsonl"));
    } catch {
      return new Set();
    }
    const files = await Promise.all(
      names.map((n) => readJsonlFile(path.join(dir, n), TombstoneLine)),
    );
    return deletedHashes(mergeLines(...files.map((f) => f.lines)));
  }
}
