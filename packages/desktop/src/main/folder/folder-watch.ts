import { watch, type FSWatcher } from "node:fs";
import path from "node:path";

/**
 * Notices files added, renamed or removed in an open folder by anything but
 * Anur, as Finder does, so the files panel keeps up. Hidden paths, such as
 * `.anur` and `.git`, are ignored; bursts are told once, after a pause, and
 * a long trickle (iCloud downloading a folder) at most once per `capMs`.
 */
export class FolderWatch {
  private readonly watchers = new Map<
    number,
    { watcher: FSWatcher; timer?: NodeJS.Timeout; since?: number | undefined }
  >();

  constructor(
    private readonly changed: (windowId: number) => void,
    private readonly pauseMs = 250,
    private readonly capMs = 2000,
  ) {}

  start(windowId: number, folder: string): void {
    this.stop(windowId);
    let watcher: FSWatcher;
    try {
      const own = path.basename(folder);
      watcher = watch(folder, { recursive: true }, (event, name) => {
        const rel = typeof name === "string" ? name : "";
        if (rel.split(/[\\/]/).some((part) => part.startsWith("."))) return;
        // macOS also reports the folder itself, by its own name, changing.
        if (event === "change" && rel === own) return;
        const entry = this.watchers.get(windowId);
        if (!entry) return;
        clearTimeout(entry.timer);
        entry.since ??= Date.now();
        const left = entry.since + this.capMs - Date.now();
        entry.timer = setTimeout(
          () => {
            entry.since = undefined;
            this.changed(windowId);
          },
          Math.max(0, Math.min(this.pauseMs, left)),
        );
      });
    } catch {
      return; // A folder that can't be watched still works; it just doesn't update itself.
    }
    watcher.on("error", () => {
      this.stop(windowId);
    });
    this.watchers.set(windowId, { watcher });
  }

  stop(windowId: number): void {
    const entry = this.watchers.get(windowId);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.watcher.close();
    this.watchers.delete(windowId);
  }
}
