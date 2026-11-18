import type { FolderState } from "../../../shared/ipc-contract.ts";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A new listing, reusing the old one's parts that didn't change, and the old
 * listing itself when nothing did: only what changed redraws.
 */
export function keepSame(was: FolderState | null, now: FolderState | null): FolderState | null {
  if (!was || !now || was.path !== now.path) return now;
  const next = { ...now };
  let changed = false;
  for (const key of Object.keys(now) as (keyof FolderState)[]) {
    if (same(was[key], now[key])) (next as Record<string, unknown>)[key] = was[key];
    else changed = true;
  }
  return changed ? next : was;
}
