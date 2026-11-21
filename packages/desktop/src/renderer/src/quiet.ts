/**
 * Whether this window is quiet enough for Anur to restart into an update
 * unasked: nothing typed and unsaved, nothing unsent, no planned run queued.
 * Each part of the window that can hold such work registers its own check.
 */
import { planQueue } from "./regions/plan-queue.ts";
import { anyDraft } from "./regions/think-memory.ts";

const busy = new Set<() => boolean>();

/** Something here holds work while `check` says so; returns its removal. */
export function holdsWork(check: () => boolean): () => void {
  busy.add(check);
  return () => {
    busy.delete(check);
  };
}

export function isQuiet(): boolean {
  if (anyDraft(window.localStorage) || planQueue.get().length > 0) return false;
  for (const check of busy) if (check()) return false;
  return true;
}

declare global {
  interface Window {
    /** Asked by main before a quiet restart into an update. */
    anurQuiet?: () => boolean;
  }
}
window.anurQuiet = isQuiet;
