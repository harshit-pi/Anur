import type { ThreadView } from "../../../shared/ipc-contract.ts";

/**
 * Why a planned action can't run yet (30.26), or null when it can: an earlier
 * action in the same plan isn't done, or a choice it depends on is still open.
 */

type Offer = Extract<ThreadView["items"][number], { kind: "options" }>;

const samePath = (a: readonly string[] | null, b: readonly string[] | null) =>
  !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);

/** A single pick still to make; parts left unadded are optional, so they don't hold work up. */
function isOpen(o: Offer, all: readonly Offer[]): boolean {
  if (o.several || o.used !== null) return false;
  if (o.options.every((x) => o.skipped.includes(x.id))) return false;
  // Narrower choices count only under the option that was picked.
  if (o.within) {
    const parent = all.find((p) => p.options.some((x) => x.id === o.within));
    if (parent && parent.used !== null && parent.used !== o.within) return false;
  }
  return true;
}

/** The open choices in a thread, the latest ask of each kept (an ask again replaces the earlier one). */
function openChoices(t: ThreadView): Offer[] {
  const offers = t.items.flatMap((x) => (x.kind === "options" ? [x] : []));
  const latest = new Map<string, Offer>();
  for (const o of offers)
    latest.set(
      o.within ? `w:${o.within}:${o.heading ?? ""}` : `h:${(o.heading ?? "").toLowerCase()}`,
      o,
    );
  return [...latest.values()].filter((o) => isOpen(o, offers));
}

export function actionWaits(
  threads: readonly ThreadView[],
  from: ThreadView,
  actionId: string,
): string | null {
  const plan = from.items.flatMap((x) => (x.kind === "proposed-action" ? [x] : []));
  const at = plan.findIndex((x) => x.id === actionId);
  const action = plan[at];
  if (!action) return null;
  for (const earlier of plan.slice(0, at)) {
    const run = earlier.run ? threads.find((t) => t.id === earlier.run) : undefined;
    // Run and not loaded here: it can't be told apart from done, so it doesn't hold this up.
    if (!earlier.run || (run && run.action?.state !== "done")) return `Waits on “${earlier.title}”`;
  }
  const target = action.path ?? from.path;
  for (const t of threads) {
    if (t.closed || (t.id !== from.id && !samePath(t.path, target))) continue;
    const open = openChoices(t)[0];
    if (open) return `Waits on your pick: “${open.heading ?? t.title}”`;
  }
  return null;
}
