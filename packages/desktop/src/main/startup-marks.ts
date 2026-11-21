import { logLine } from "./log.ts";

/**
 * How long launch takes, step by step, in Anur's log: each step once, timed
 * from the process starting, for the first few minutes only. Read after an
 * update to see where its first launch spends its time.
 */
const WINDOW_MS = 3 * 60 * 1000;
const seen = new Set<string>();

export function startupMark(name: string, version: string, where = "main"): void {
  const ms = Math.round(process.uptime() * 1000);
  const key = `${where}:${name}`;
  if (ms > WINDOW_MS || seen.has(key)) return;
  seen.add(key);
  logLine("info", "startup", `${name}: ${String(ms)} ms (${where}, ${version})`);
}

/** A window's call to main that took long during launch, by its channel. */
export function slowCall(channel: string, ms: number, version: string, where: string): void {
  if (ms < 300 || process.uptime() * 1000 > WINDOW_MS) return;
  logLine(
    "info",
    "startup",
    `slow call ${channel}: ${String(Math.round(ms))} ms (${where}, ${version})`,
  );
}
