import { execFile } from "node:child_process";

/**
 * The memory the agents use (13.4): Anur's agent host and every process
 * under it, such as Claude Code's sessions, added up from `ps`.
 */
export function treeRssKb(ps: string, root: number): number {
  const kids = new Map<number, number[]>();
  const rss = new Map<number, number>();
  for (const line of ps.split("\n")) {
    const [pid, ppid, kb] = line.trim().split(/\s+/).map(Number);
    if (pid === undefined || ppid === undefined || kb === undefined || Number.isNaN(kb)) continue;
    rss.set(pid, kb);
    kids.set(ppid, [...(kids.get(ppid) ?? []), pid]);
  }
  let total = 0;
  const seen = new Set<number>();
  const walk = (pid: number) => {
    if (seen.has(pid)) return;
    seen.add(pid);
    total += rss.get(pid) ?? 0;
    for (const k of kids.get(pid) ?? []) walk(k);
  };
  walk(root);
  return total;
}

/** Megabytes in use by `root` and its descendants; null when it can't be read. */
export function agentMemoryMb(root: number | null): Promise<number | null> {
  if (root === null || process.platform === "win32") return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile("/bin/ps", ["-axo", "pid=,ppid=,rss="], { timeout: 5000 }, (err, out) => {
      resolve(err ? null : Math.round(treeRssKb(out, root) / 1024));
    });
  });
}
