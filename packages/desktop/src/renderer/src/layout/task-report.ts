/**
 * A task report as the task tab shows it (21.3): items ranked data, auth,
 * calls, Claude's choices, UI, other; at most three before "more".
 */
import type { z } from "zod";
import type { TaskReportView } from "../../../shared/ipc-contract.ts";

export type TaskReport = z.infer<typeof TaskReportView>;
export type ReportLine = TaskReport["lines"][number];

/** The tab path that shows one task's report. */
export const TASK_PREFIX = "anur:task/";
export const taskTab = (id: string) => `${TASK_PREFIX}${id}`;
export const taskIdOf = (p: string | null) =>
  p?.startsWith(TASK_PREFIX) ? p.slice(TASK_PREFIX.length) : null;

export type ReportItem = { kind: "line"; line: ReportLine } | { kind: "choice"; text: string };

const LABEL: Record<ReportLine["category"], string> = {
  data: "Data",
  auth: "Auth",
  calls: "Calls",
  ui: "UI",
  other: "Other",
};
export const labelOf = (item: ReportItem) =>
  item.kind === "choice" ? "Claude's choice" : LABEL[item.line.category];

/** Every item, ranked: data, auth, calls, Claude's choices, UI, other. */
export function reportItems(r: TaskReport): ReportItem[] {
  const of = (cats: ReportLine["category"][]) =>
    r.lines
      .filter((l) => cats.includes(l.category))
      .map((line): ReportItem => ({ kind: "line", line }));
  return [
    ...of(["data"]),
    ...of(["auth"]),
    ...of(["calls"]),
    ...r.choices.map((text): ReportItem => ({ kind: "choice", text })),
    ...of(["ui"]),
    ...of(["other"]),
  ];
}

/** What "more" holds, in words: "2 UI changes · 1 other". */
export function moreSummary(rest: readonly ReportItem[]): string {
  const counts = new Map<string, number>();
  for (const it of rest) {
    const k =
      it.kind === "choice"
        ? "of Claude's choices"
        : it.line.category === "ui"
          ? "UI"
          : it.line.category;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts].map(([k, n]) => `${String(n)} ${k}`).join(" · ");
}

/** The task's title: the start of the prompt that began it. */
export function taskTitle(r: Pick<TaskReport, "prompt">): string {
  const t = r.prompt.replace(/\s+/g, " ").trim();
  return t ? (t.length > 70 ? `${t.slice(0, 67)}…` : t) : "A task";
}

/** Where a line points: "file:line", or the file when deleted. */
export const citeOf = (l: ReportLine) => (l.line ? `${l.file}:${String(l.line)}` : l.file);

/** "api ▸ @acme/api", or the repo alone. */
export const placeOf = (l: ReportLine) => (l.part ? `${l.repo} ▸ ${l.part}` : l.repo);
