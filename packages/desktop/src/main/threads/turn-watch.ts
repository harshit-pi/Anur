import { createHash } from "node:crypto";
import { type FSWatcher, watch } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { listDocs } from "../folder/list-docs.ts";

/**
 * Docs written while a thread's turn runs (task 3.11; Architecture, "Who
 * writes the file"). A write that lands during a turn, from git, another
 * editor or the agent's own shell, is never silent: the thread shows it,
 * "changed while this thread was running", with Revert.
 *
 * While any turn runs in the folder, its docs are watched. Each doc's text
 * before the change comes from a cache read when the turn starts, re-read
 * only for files whose time changed, so Revert has something to go back to.
 * Anur's own writes are recognised by their content and never reported, and
 * neither is a file last written before the turn began: a move, a rename or
 * an iCloud download shows up as a new path, but its text didn't change.
 */

export type DocChange = { rel: string; before: string | null; after: string };

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/** Docs larger than this are watched without a copy of their text; they can't be reverted. */
const MAX_CACHED_DOC = 2 * 1024 * 1024;
const MAX_CACHED_TOTAL = 64 * 1024 * 1024;

export class TurnWatch {
  private readonly cache = new Map<string, { mtime: number; text: string }>();
  private readonly own = new Map<string, { hash: string; at: number }>();
  private readonly running = new Set<string>();
  /** When each running turn started: a file last written before the earliest wasn't written by it. */
  private readonly started = new Map<string, number>();
  private watcher: FSWatcher | null = null;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly folder: string,
    private readonly onChange: (change: DocChange, threads: string[]) => void,
    private readonly settleMs = 300,
  ) {}

  /** Anur itself wrote this text to the doc: not an outside change. */
  ownWrite(rel: string, text: string): void {
    this.own.set(rel, { hash: hash(text), at: Date.now() });
    const prev = this.cache.get(rel);
    this.cache.set(rel, { mtime: prev?.mtime ?? 0, text });
  }

  /** A thread's turn starts: watch the folder, and bring the cache up to date. */
  async start(thread: string): Promise<void> {
    this.running.add(thread);
    this.started.set(thread, Date.now());
    if (!this.watcher) {
      try {
        this.watcher = watch(this.folder, { recursive: true }, (_e, name) => {
          if (typeof name === "string") this.changed(name.split(path.sep).join("/"));
        });
        this.watcher.on("error", () => undefined);
      } catch {
        this.watcher = null;
      }
    }
    await this.refresh();
  }

  /** A thread's turn ended; the watch stops when no turn runs. */
  stop(thread: string): void {
    this.running.delete(thread);
    this.started.delete(thread);
    if (this.running.size === 0) {
      this.watcher?.close();
      this.watcher = null;
      for (const t of this.timers.values()) clearTimeout(t);
      this.timers.clear();
    }
  }

  close(): void {
    this.running.clear();
    this.stop("");
  }

  /** Each doc's text as it is, read only where the file's time changed. */
  private async refresh(): Promise<void> {
    const { docs } = await listDocs(this.folder);
    let total = 0;
    for (const rel of docs) {
      try {
        const s = await stat(path.join(this.folder, rel));
        if (s.size > MAX_CACHED_DOC || total + s.size > MAX_CACHED_TOTAL) continue;
        total += s.size;
        const known = this.cache.get(rel);
        if (known?.mtime === s.mtimeMs) continue;
        this.cache.set(rel, {
          mtime: s.mtimeMs,
          text: await readFile(path.join(this.folder, rel), "utf8"),
        });
      } catch {
        // Gone, unreadable or still in iCloud: no text kept for it.
      }
    }
  }

  private changed(rel: string): void {
    if (!rel.toLowerCase().endsWith(".md") || rel.split("/").some((p) => p.startsWith("."))) return;
    clearTimeout(this.timers.get(rel));
    this.timers.set(
      rel,
      setTimeout(() => {
        this.timers.delete(rel);
        void this.check(rel);
      }, this.settleMs),
    );
  }

  private async check(rel: string): Promise<void> {
    if (this.running.size === 0) return;
    let after: string;
    let mtime: number;
    try {
      after = await readFile(path.join(this.folder, rel), "utf8");
      mtime = (await stat(path.join(this.folder, rel))).mtimeMs;
    } catch {
      return; // Deleted: the doc's own page says so.
    }
    const known = this.cache.get(rel);
    const mine = this.own.get(rel);
    this.cache.set(rel, { mtime, text: after });
    if (known?.text === after) return;
    // Moved, renamed, or downloaded by iCloud: the path is new but the file
    // was last written before the turn began, so nothing in it changed now.
    const since = Math.min(...this.started.values());
    if (mtime < since - 1000) return;
    // Anur's own save, from a page or an Apply, in the last minute.
    if (mine && mine.hash === hash(after) && Date.now() - mine.at < 60_000) return;
    this.onChange({ rel, before: known?.text ?? null, after }, [...this.running]);
  }
}
