import { useSyncExternalStore } from "react";
import type { ThreadView } from "../../../shared/ipc-contract.ts";
import { actionWaits } from "./action-waits.ts";

/**
 * A plan run in order (Run all, or Build this section on a section with
 * planned actions): each action starts when the one before it is done.
 */
export type Step = { thread: string; action: string };

let queue: readonly Step[] = [];
const listeners = new Set<() => void>();

export const planQueue = {
  get: () => queue,
  set: (next: readonly Step[]) => {
    queue = next;
    for (const l of listeners) l();
  },
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export function usePlanQueue(): readonly Step[] {
  return useSyncExternalStore(planQueue.subscribe, planQueue.get);
}

export const queued = (q: readonly Step[], s: Step) =>
  q.some((x) => x.thread === s.thread && x.action === s.action);

type Action = Extract<ThreadView["items"][number], { kind: "proposed-action" }>;
const actionOf = (threads: readonly ThreadView[], s: Step) => {
  const from = threads.find((t) => t.id === s.thread);
  const a = from?.items.find((x): x is Action => x.kind === "proposed-action" && x.id === s.action);
  return from && a ? { from, a } : null;
};
const stateOf = (threads: readonly ThreadView[], run: string) =>
  threads.find((t) => t.id === run)?.action?.state ?? null;

/**
 * The queue after what has happened: done steps drop off; the next one is
 * returned to run once it's ready. A run that failed or was stopped, or a pick
 * still to make, ends the plan there. A run waiting on the person pauses it.
 */
export function advance(
  q: readonly Step[],
  threads: readonly ThreadView[],
): { queue: readonly Step[]; run: Step | null } {
  let rest = q;
  while (rest.length > 0) {
    const s = rest[0] as Step;
    const found = actionOf(threads, s);
    if (!found) {
      rest = rest.slice(1);
      continue;
    }
    const { from, a } = found;
    if (a.run) {
      const state = stateOf(threads, a.run);
      if (state === "done") {
        rest = rest.slice(1);
        continue;
      }
      // Running, waiting on the person, or not loaded yet: wait for it.
      if (state === null || state === "running" || state === "needs")
        return { queue: rest, run: null };
      return { queue: [], run: null };
    }
    const waits = actionWaits(threads, from, a.id);
    if (waits === null) return { queue: rest, run: s };
    // Waits on an earlier action that's still going: wait; anything else ends the plan.
    const plan = from.items.filter((x): x is Action => x.kind === "proposed-action");
    const going = plan
      .slice(
        0,
        plan.findIndex((x) => x.id === a.id),
      )
      .some((x) => x.run && ["running", "needs", null].includes(stateOf(threads, x.run)));
    return going ? { queue: rest, run: null } : { queue: [], run: null };
  }
  return { queue: [], run: null };
}

/** A section's planned actions not yet run, in the order their threads proposed them. */
export function plannedOn(threads: readonly ThreadView[], path: readonly string[]): Step[] {
  const same = (p: readonly string[] | null) =>
    !!p && p.length === path.length && p.every((x, i) => x === path[i]);
  return threads.flatMap((t) =>
    t.items.flatMap((x) =>
      x.kind === "proposed-action" && !x.run && same(x.path ?? t.path)
        ? [{ thread: t.id, action: x.id }]
        : [],
    ),
  );
}
