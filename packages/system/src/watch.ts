/**
 * One watcher per repo (20.8): a change to a build file, outside the usual
 * output folders, calls back once things go quiet, so the system is read
 * again. Only build files matter to parts, so the rest of the tree is noise.
 */
import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { findRepoDirs, SKIP_DIRS } from "./repos.ts";

const BUILD_FILE =
  /^(package\.json|pyproject\.toml|go\.mod|Cargo\.toml|serverless\.ya?ml|cdk\.json)$/;
/** CDK app files name the stacks; any source file may be one. */
const SOURCE = /\.(ts|py)$/;

/** Whether a changed path, relative to its repo, can change the system. */
export function mattersForParts(rel: string): boolean {
  const parts = rel.split(/[\\/]/);
  if (parts.some((p) => SKIP_DIRS.has(p) || p.startsWith("."))) return false;
  const name = parts.at(-1) ?? "";
  return BUILD_FILE.test(name) || SOURCE.test(name);
}

/**
 * Watches every repo in the folder; `onChange` runs `quietMs` after the last
 * change that matters. A repo added or removed shows on the next rescan.
 * Returns a function that stops every watcher.
 */
export function watchSystem(folder: string, onChange: () => void, quietMs = 300): () => void {
  const watchers: FSWatcher[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const poke = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, quietMs);
  };
  for (const rel of findRepoDirs(folder)) {
    try {
      const w = watch(path.join(folder, rel), { recursive: true }, (_event, file) => {
        if (file && mattersForParts(file)) poke();
      });
      w.on("error", () => {
        // A repo deleted while watched: its watcher stops; the next scan drops it.
      });
      watchers.push(w);
    } catch {
      // Unreadable or gone: nothing to watch.
    }
  }
  return () => {
    if (timer) clearTimeout(timer);
    for (const w of watchers) w.close();
  };
}
