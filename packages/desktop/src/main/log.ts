import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { format } from "node:util";

/**
 * Anur's log, where macOS apps keep theirs: `~/Library/Logs/Anur/main.log`,
 * readable in Console.app. Append-only, one line per event with its time and
 * level, each on disk before the app goes on, so a hang or crash still leaves
 * what led up to it. Past 5 MB it rolls to `main.old.log`, which goes after
 * 14 days: never more than about 10 MB.
 */
export type Level = "info" | "warn" | "error";

const MAX_BYTES = 5 * 1024 * 1024;
const KEEP_OLD_MS = 14 * 24 * 60 * 60 * 1000;
let file: string | null = null;

export function logLine(level: Level, where: string, ...parts: unknown[]): void {
  if (!file) return;
  const text = format(...parts).replace(/\n(?!$)/g, "\n    ");
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${where}] ${text}\n`;
  try {
    if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > MAX_BYTES)
      renameSync(file, file.replace(/\.log$/, ".old.log"));
    appendFileSync(file, line);
  } catch {
    // A full or read-only disk: the app goes on without its log.
  }
}

/**
 * Starts the log in `dir`, and copies the main process's console into it, as
 * well as errors nothing caught, so nothing that went wrong is lost.
 */
export function startLog(dir: string, header: string): string {
  mkdirSync(dir, { recursive: true });
  file = path.join(dir, "main.log");
  const old = path.join(dir, "main.old.log");
  const oldAt = statSync(old, { throwIfNoEntry: false })?.mtimeMs;
  if (oldAt !== undefined && Date.now() - oldAt > KEEP_OLD_MS) rmSync(old, { force: true });
  logLine("info", "app", header);
  for (const [name, level] of [
    ["log", "info"],
    ["info", "info"],
    ["warn", "warn"],
    ["error", "error"],
  ] as const) {
    const original = console[name].bind(console);
    console[name] = (...args: unknown[]) => {
      original(...args);
      logLine(level, "main", ...args);
    };
  }
  process.on("uncaughtException", (e) => {
    logLine("error", "main", "Uncaught:", e);
  });
  process.on("unhandledRejection", (e) => {
    logLine("error", "main", "Unhandled rejection:", e);
  });
  return file;
}
