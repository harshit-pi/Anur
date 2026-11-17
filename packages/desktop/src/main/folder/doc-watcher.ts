import { type FSWatcher, watch } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { decodeDoc } from "../../vault/doc-file.ts";
import { hashBytes } from "./save-doc.ts";

/**
 * Watching each window's open doc for changes made outside Anur (task 2.17).
 * Each window has one doc open; its watcher remembers the hash of the bytes
 * Anur last read or wrote, so Anur's own saves are recognised by content and
 * never reported. The folder is watched rather than the file, because an
 * atomic save, Anur's or another editor's, replaces the file it would watch.
 */

export type OutsideChange =
  | { kind: "changed"; path: string; text: string; hash: string }
  | { kind: "gone"; path: string }
  | { kind: "unreadable"; path: string; reason: string };

type Watched = {
  rel: string;
  file: string;
  hash: string;
  watcher: FSWatcher;
  timer: ReturnType<typeof setTimeout> | null;
};

export class DocWatcher {
  private readonly byWindow = new Map<number, Watched>();

  constructor(
    private readonly report: (windowId: number, change: OutsideChange) => void,
    private readonly settleMs = 120,
  ) {}

  /** Watch `rel` in `folder` for `windowId`, replacing whatever it watched before. */
  watch(windowId: number, folder: string, rel: string, hash: string): void {
    this.stop(windowId);
    const file = path.join(folder, rel);
    const name = path.basename(file);
    const watcher = watch(path.dirname(file), (_event, changed) => {
      if (changed !== null && changed !== name) return;
      const w = this.byWindow.get(windowId);
      if (!w) return;
      // Writes arrive as bursts of events: check once they settle.
      if (w.timer) clearTimeout(w.timer);
      w.timer = setTimeout(() => {
        w.timer = null;
        void this.check(windowId);
      }, this.settleMs);
    });
    watcher.on("error", () => {
      this.stop(windowId);
    });
    this.byWindow.set(windowId, { rel, file, hash, watcher, timer: null });
  }

  /** Anur read or wrote the doc: these bytes are its own. */
  setHash(windowId: number, rel: string, hash: string): void {
    const w = this.byWindow.get(windowId);
    if (w?.rel === rel) w.hash = hash;
  }

  stop(windowId: number): void {
    const w = this.byWindow.get(windowId);
    if (!w) return;
    if (w.timer) clearTimeout(w.timer);
    w.watcher.close();
    this.byWindow.delete(windowId);
  }

  stopAll(): void {
    for (const id of [...this.byWindow.keys()]) this.stop(id);
  }

  private async check(windowId: number): Promise<void> {
    const w = this.byWindow.get(windowId);
    if (!w) return;
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(w.file));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        this.report(windowId, { kind: "gone", path: w.rel });
      }
      return;
    }
    const hash = hashBytes(bytes);
    if (hash === w.hash || this.byWindow.get(windowId) !== w) return;
    w.hash = hash;
    const doc = decodeDoc(bytes);
    if (doc.mode !== "editable") {
      this.report(windowId, {
        kind: "unreadable",
        path: w.rel,
        reason: doc.note ?? "Anur can no longer edit this doc.",
      });
      return;
    }
    this.report(windowId, { kind: "changed", path: w.rel, text: doc.text, hash });
  }
}
