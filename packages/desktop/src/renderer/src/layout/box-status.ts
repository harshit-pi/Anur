import type { ThreadView } from "../../../shared/ipc-contract.ts";

/**
 * What happened on a box, said on the box itself (mock 9): the one thing a
 * person would want to know first about the section's threads. Waiting on
 * them comes first, then work under way, then what was settled.
 */
export type BoxStatus = { label: string; tone: "blue" | "green" | "amber" };

type Thread = Pick<ThreadView, "busy" | "closed" | "purpose" | "items">;

export function boxStatus(threads: readonly Thread[], previewed: number): BoxStatus | null {
  const open = threads.filter((t) => !t.closed);
  const offers = open.flatMap((t) => t.items.flatMap((x) => (x.kind === "options" ? [x] : [])));
  const waiting = offers.filter((x) => !x.used);
  // Waiting on the person: options to pick, an edit to use.
  if (waiting.length) {
    const n = waiting.reduce((sum, x) => sum + x.options.length, 0);
    return { label: `${String(n)} option${n === 1 ? "" : "s"}`, tone: "blue" };
  }
  if (previewed > 0)
    return {
      label: previewed === 1 ? "Edit to use" : `${String(previewed)} edits to use`,
      tone: "blue",
    };
  // Under way.
  const running = open.find((t) => t.busy);
  if (running)
    return {
      label:
        running.purpose === "build"
          ? "Building…"
          : running.purpose === "check"
            ? "Checking…"
            : "Thinking…",
      tone: "blue",
    };
  // What a Check found, if it found anything.
  for (const t of [...threads].reverse()) {
    const check = t.items.findLast((x) => x.kind === "check");
    if (check?.kind !== "check") continue;
    const off = check.claims.filter((c) => c.verdict !== "holds").length;
    return off
      ? { label: `Check: ${String(off)} to look at`, tone: "amber" }
      : { label: "Checked", tone: "green" };
  }
  // What a Build made.
  const made = threads
    .filter((t) => t.purpose === "build")
    .flatMap((t) => t.items.flatMap((x) => (x.kind === "created" && !x.undone ? [x] : [])));
  if (made.length)
    return {
      label: `Built · ${String(made.length)} doc${made.length === 1 ? "" : "s"}`,
      tone: "green",
    };
  if (threads.some((t) => t.purpose === "build")) return { label: "Built", tone: "green" };
  // The option the person picked.
  const picked = [...offers].reverse().find((x) => x.used);
  const title = picked?.options.find((o) => o.id === picked.used)?.title;
  if (title)
    return {
      label: `Picked: ${title.length > 28 ? `${title.slice(0, 27)}…` : title}`,
      tone: "green",
    };
  return null;
}
