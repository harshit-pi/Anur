/**
 * A thread's items as Think lists them: tool steps folded under the reply they led to, branches after their source.
 */
import { serviceOf } from "../icons/services/index.tsx";
import type { ThreadItem, ThreadView } from "../../../shared/ipc-contract.ts";
import { doingOf, listOf, ownToolName, stepOf } from "./step-label.ts";

/** The step the agent is on now: its last tool call this turn, if that's still running. */
export function runningStep(items: ThreadItem[]): string | null {
  const last = items.at(-1);
  return last?.kind === "tool" &&
    !/^(completed|failed)$/.test(last.status) &&
    !HOUSEKEEPING.test(last.title)
    ? doingOf(last.title)
    : null;
}

export type ToolItem = Extract<ThreadItem, { kind: "tool" }>;

/** Anur's own bookkeeping, never shown as the agent's work. */
// Steps a person never needs, and steps a card in the chat already stands for.
export const HOUSEKEEPING =
  /^(mcp__anur__anur_(name_thread|list_inputs|propose_finding|offer_options|report_check)|ToolSearch)\b/;

export type Folded = { item: ThreadItem; i: number; steps: ToolItem[] | null; leads?: boolean };

export function foldSteps(items: ThreadItem[], busy?: boolean): Folded[] {
  const out: Folded[] = [];
  let run: ToolItem[] = [];
  let start = 0;
  const flush = () => {
    const [first] = run;
    if (run.length === 1 && first) out.push({ item: first, i: start, steps: null });
    else if (first) out.push({ item: first, i: start, steps: run });
    run = [];
  };
  items.forEach((item, i) => {
    if (item.kind === "tool" && HOUSEKEEPING.test(item.title)) return;
    if (item.kind === "tool") {
      if (run.length === 0) start = i;
      run.push(item);
      return;
    }
    flush();
    out.push({ item, i, steps: null });
  });
  flush();
  return busy === undefined ? out : answerFirst(out, busy);
}

export const CARD_KINDS = new Set(["finding", "options"]);

/**
 * A finished turn's reply leads it: the agent writes its answer last, after
 * the findings and options it made on the way, but a person reads the
 * answer first. The reply moves above the turn's first card, and the cards
 * follow under "From this answer". A running turn stays in the order it
 * arrives.
 */
export function answerFirst(entries: Folded[], busy: boolean): Folded[] {
  const out: Folded[] = [];
  let turn: Folded[] = [];
  const flushTurn = (last: boolean) => {
    const reply = turn.findLastIndex((e) => e.item.kind === "message" && e.item.role === "agent");
    const card = turn.findIndex((e) => CARD_KINDS.has(e.item.kind));
    const at = reply >= 0 ? turn[reply] : undefined;
    if (at && card >= 0 && card < reply && !(last && busy)) {
      turn.splice(reply, 1);
      turn.splice(card, 0, { ...at, leads: true });
    }
    out.push(...turn);
    turn = [];
  };
  for (const e of entries) {
    if (e.item.kind === "message" && e.item.role === "person") flushTurn(false);
    turn.push(e);
  }
  flushTurn(true);
  return out;
}

/** Newest first, each branch right under the thread it came from (10.5). */
export function withBranches(threads: ThreadView[]): ThreadView[] {
  const newest = [...threads].sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
  const ids = new Set(newest.map((t) => t.id));
  const out: ThreadView[] = [];
  const place = (t: ThreadView) => {
    out.push(t);
    for (const b of newest) if (b.branchedFrom?.thread === t.id) place(b);
  };
  for (const t of newest) {
    const from = t.branchedFrom?.thread;
    if (!from || !ids.has(from)) place(t);
  }
  return out;
}

/** A finished tool step in a few words. */
export function toolLabel(title: string): string {
  if (title === "Approve Plan") return "Asked you to approve the plan";
  if (/^Write \S*\/\.claude\/plans\//.test(title)) return "Wrote the plan";
  const own = ownToolName(title, "done");
  if (own) return own;
  // A service the agent acted in: "Linear: save issue", shown with its mark.
  const service = serviceOf(title);
  if (service) return `${service.name}: ${service.action}`;
  return stepOf(title).label;
}

/** A finished run in one line: the files it read, then anything else it did. */
export function stepsSummary(steps: { title: string }[]): string {
  const all = steps.map((t) => (t.title.startsWith("mcp__anur__") ? null : stepOf(t.title)));
  const read = all.flatMap((x) => x?.read ?? []);
  const other = [...new Set(all.flatMap((x) => (x && x.read.length === 0 ? [x.label] : [])))];
  const parts = [...(read.length ? [`Read ${listOf(read)}`] : []), ...other];
  return parts.length ? parts.slice(0, 3).join(", ") : toolLabel(steps.at(-1)?.title ?? "");
}

/**
 * Where a branch thread sits: the decision it started from, then each option
 * it narrows, oldest first ("Activation event › Dashboard saved on own data").
 */
export function exploresPath(thread: ThreadView, threads: ThreadView[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let up = thread.explores ?? null;
  while (up && !seen.has(up.thread)) {
    seen.add(up.thread);
    const option = up.option;
    const from = threads.find((t) => t.id === up?.thread);
    if (!from) break;
    const offer = from.items.find(
      (x) => x.kind === "options" && x.options.some((o) => o.id === option),
    );
    if (offer?.kind !== "options") break;
    const o = offer.options.find((x) => x.id === option);
    if (o) out.unshift(o.title);
    up = from.explores ?? null;
    if (!up) out.unshift(offer.heading ?? from.title);
  }
  return out;
}
