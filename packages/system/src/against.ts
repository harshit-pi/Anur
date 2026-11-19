import { execFileSync } from "node:child_process";
import path from "node:path";
import { untilPassed } from "@anur/core";
import { INTERNAL_MARK } from "./choices.ts";
import type { Edge } from "./edges.ts";
import type { Part } from "./parts.ts";
import type { TaskReport } from "./tasks.ts";

/**
 * "Against" (24.1): at task end, whether the change goes against a decision
 * people made on what it touched. Only decisions in scope are asked about:
 * the touched parts', the lines whose call or route is in a touched file,
 * and the touched repos' repo-wide ones. With none, nothing is asked. The
 * person's own agent answers once, in a short session of its own; an answer
 * below 0.7 is put to the person as a question, never asserted.
 */

export const AGAINST_SURE = 0.7;
/** Below this the agent wasn't saying it goes against at all. */
const AGAINST_FLOOR = 0.3;

export type InScope = {
  id: string;
  decision: string;
  who: string | null;
  at: string;
  quote: string | null;
  /** Where the decision lives, from the opened folder. */
  home: string;
  /** Why it's in scope, as a person reads it: "on Checkout", "on POST /v1/checkout". */
  on: string;
};

export type AgainstFound = {
  /** The decision gone against. */
  target: string;
  decision: string;
  who: string | null;
  at: string;
  why: string;
  confidence: number;
  file: string | null;
  line: number | null;
  /** "asserted" at 0.7 and up; "asked" below, until the person says. */
  status: "asserted" | "asked" | "confirmed" | "dismissed";
};

type Entry = {
  id: string;
  kind: string;
  scope: string;
  home: string;
  at: string;
  decision?: string | undefined;
  quote?: string | null | undefined;
  who?: string | null | undefined;
  until?: string | null | undefined;
  on?: string | null | undefined;
};

/** The decisions a task's changes could go against. */
export function decisionsInScope(
  report: Pick<TaskReport, "lines">,
  entries: readonly Entry[],
  parts: readonly Part[],
  edges: readonly Edge[],
  now: Date = new Date(),
): InScope[] {
  const files = new Set(report.lines.map((l) => l.file));
  const repos = new Set(report.lines.map((l) => l.repo));
  const touchedParts = new Map(
    report.lines.flatMap((l) => {
      const p = l.part ? parts.find((x) => x.repo === l.repo && x.name === l.part) : undefined;
      return p ? [[p.id, p.name] as const] : [];
    }),
  );
  const fileOf = (cite: string | null) => cite?.replace(/:\d+$/, "") ?? null;
  const out: InScope[] = [];
  for (const e of entries) {
    if (e.kind !== "decision" || !e.decision) continue;
    // One past its "until" no longer holds (18.2).
    if (untilPassed(e.until ?? null, e.at, now)) continue;
    let on: string | null = null;
    const part = /^part:(.+)$/.exec(e.scope)?.[1];
    const edge = /^edge:(.+)$/.exec(e.scope)?.[1];
    const folder = /^folder:(.+)$/.exec(e.scope)?.[1];
    if (part) on = touchedParts.has(part) ? `on ${touchedParts.get(part) ?? part}` : null;
    else if (edge) {
      const l = edges.find((x) => x.id === edge || x.aliases?.includes(edge));
      const touched =
        l && [fileOf(l.evidence), fileOf(l.declared)].some((f) => f !== null && files.has(f));
      on = touched ? `on ${e.on ?? `${l.method ? `${l.method} ` : ""}${l.route}`}` : null;
    } else if (e.scope === "repo")
      on = repos.has(e.home) ? `all of ${e.home || "the folder"}` : null;
    else if (folder) {
      const dir = [e.home, folder].filter(Boolean).join("/");
      on = [...files].some((f) => f.startsWith(`${dir}/`)) ? `all of ${dir}` : null;
    }
    if (on)
      out.push({
        id: e.id,
        decision: e.decision,
        who: e.who ?? null,
        at: e.at,
        quote: e.quote ?? null,
        home: e.home,
        on,
      });
  }
  return out;
}

/** What the task changed, as a diff per repo, cut to fit one short question. */
export function diffOf(
  folder: string,
  report: Pick<TaskReport, "repos" | "lines">,
  max = 40_000,
): string {
  const parts: string[] = [];
  for (const r of report.repos) {
    const files = report.lines
      .filter((l) => l.repo === r.dir)
      .map((l) => path.relative(r.dir, l.file).split(path.sep).join("/"));
    if (!files.length) continue;
    const args = r.from
      ? ["diff", "--no-color", r.from, "--", ...files]
      : ["diff", "--no-color", "--", ...files];
    try {
      const text = execFileSync("git", ["-C", path.join(folder, r.dir), ...args], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      });
      if (text.trim()) parts.push(`# ${r.dir}\n${text}`);
    } catch {
      // A repo git can't diff: its lines still show in the report.
    }
  }
  const all = parts.join("\n");
  return all.length > max ? `${all.slice(0, max)}\n… (cut)` : all;
}

/** The one question to the person's agent: JSON only, never edits. */
export function againstPrompt(
  report: Pick<TaskReport, "prompt">,
  inScope: readonly InScope[],
  diff: string,
): string {
  const list = inScope
    .map(
      (d, i) =>
        `${String(i + 1)}. [${d.id}] ${d.decision}${d.quote ? ` (their words: "${d.quote}")` : ""}, ${d.who ?? "a teammate"}, ${d.on}`,
    )
    .join("\n");
  return [
    INTERNAL_MARK,
    "People on this team made these decisions about the code a task just changed. Read the change below and say, for each decision, whether the change goes against it: does the new code do what the decision rules out, or stop doing what it requires? A change that merely touches the same code isn't against it. Don't use any tools; answer from what's here.",
    "",
    "The task, as the person asked for it:",
    report.prompt.slice(0, 2000),
    "",
    "Decisions:",
    list,
    "",
    "The change:",
    "```diff",
    diff || "(no diff available)",
    "```",
    "",
    'Answer with JSON only, no prose: {"against": [{"id": "<decision id>", "confidence": <0 to 1, how sure you are it goes against>, "why": "<one sentence naming the line that does it>", "file": "<path as in the diff header, or null>", "line": <new line number, or null>}]}. List only decisions the change might go against; an empty list when none.',
  ].join("\n");
}

/** The agent's answer read into findings: at 0.7 asserted, from 0.3 asked, below dropped. */
export function readAgainst(answer: string, inScope: readonly InScope[]): AgainstFound[] {
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start < 0 || end < start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(answer.slice(start, end + 1));
  } catch {
    return [];
  }
  const items = (parsed as { against?: unknown }).against;
  if (!Array.isArray(items)) return [];
  const out: AgainstFound[] = [];
  for (const raw of items as Record<string, unknown>[]) {
    const d = inScope.find((x) => x.id === raw.id);
    const confidence = typeof raw.confidence === "number" ? raw.confidence : 0;
    if (!d || confidence < AGAINST_FLOOR || out.some((x) => x.target === d.id)) continue;
    out.push({
      target: d.id,
      decision: d.decision,
      who: d.who,
      at: d.at,
      why: typeof raw.why === "string" ? raw.why.slice(0, 400) : "",
      confidence: Math.min(1, confidence),
      file: typeof raw.file === "string" && raw.file ? raw.file.replace(/^[ab]\//, "") : null,
      line: typeof raw.line === "number" ? Math.round(raw.line) : null,
      status: confidence >= AGAINST_SURE ? "asserted" : "asked",
    });
  }
  return out;
}
