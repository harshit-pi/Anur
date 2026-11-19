/**
 * Claude Code's hooks for task boundaries (21.2): `UserPromptSubmit` marks
 * every repo in the opened folder; `Stop` compares with the mark and writes
 * the report. A hook never fails the agent: any error is swallowed and said
 * on stderr, which Claude Code shows only in verbose mode.
 */
import { rmSync } from "node:fs";
import path from "node:path";
import {
  CHOICES_ASK,
  INTERNAL_MARK,
  THREAD_PROMPT_START,
  THREAD_SESSION_ENV,
  choicesIn,
  lastReply,
} from "./choices.ts";
import { edgesIn } from "./edges.ts";
import { readReview, reviewState } from "./review.ts";
import { scanSystem } from "./system.ts";
import {
  CATEGORY_ORDER,
  folderFor,
  markTaskAsync,
  readMark,
  reportSince,
  saveMark,
  saveReport,
  tasksDir,
  type TaskReport,
} from "./tasks.ts";

export type HookInput = {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  prompt?: string;
  transcript_path?: string;
};

export type HookResult =
  | { kind: "skipped"; why: string }
  /** `context` goes back to Claude Code as the prompt's additional context. */
  | { kind: "marked"; folder: string; context: string }
  | { kind: "nothing"; folder: string }
  | { kind: "reported"; folder: string; report: TaskReport; file: string };

/** Handles one hook call. `folder` overrides the folder found from `cwd`. */
export async function handleHook(
  input: HookInput,
  folderOverride?: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<HookResult> {
  // A session Anur started for a thread is the thread's, not one of the person's tasks.
  if (env[THREAD_SESSION_ENV])
    return { kind: "skipped", why: "a session Anur started for a thread" };
  const cwd = input.cwd ?? process.cwd();
  const folder = folderOverride ?? folderFor(cwd);
  if (!folder) return { kind: "skipped", why: "no folder opened in Anur above " + cwd };
  const session = input.session_id ?? "session";
  // Anur's own one-off questions run in the folder too; they aren't tasks.
  if (input.hook_event_name === "UserPromptSubmit" && input.prompt?.includes(INTERNAL_MARK))
    return { kind: "skipped", why: "Anur's own question" };
  if (input.hook_event_name === "UserPromptSubmit" && input.prompt?.startsWith(THREAD_PROMPT_START))
    return { kind: "skipped", why: "a thread's first prompt" };
  if (input.hook_event_name === "UserPromptSubmit") {
    saveMark(folder, await markTaskAsync(folder, session, input.prompt ?? ""));
    return { kind: "marked", folder, context: CHOICES_ASK };
  }
  if (input.hook_event_name === "Stop") {
    const mark = readMark(folder, session);
    if (!mark) return { kind: "skipped", why: "no mark for this session" };
    const now = await markTaskAsync(folder, session, "");
    const scan = scanSystem(folder);
    const report = reportSince(folder, mark, scan.parts, now.repos);
    // The next task starts from here, whatever this one did.
    rmSync(path.join(tasksDir(folder), "marks", `${session.replace(/[^\w-]/g, "_")}.json`), {
      force: true,
    });
    if (!report) return { kind: "nothing", folder };
    addCalls(folder, report, scan);
    if (input.transcript_path) report.choices = choicesIn(lastReply(input.transcript_path));
    return { kind: "reported", folder, report, file: saveReport(folder, report) };
  }
  return { kind: "skipped", why: `not a task boundary: ${input.hook_event_name ?? "none"}` };
}

/**
 * The report's calls come from edges (22.5): a changed file that holds a
 * call to another repo, or outside, says what it calls, and counts as
 * "calls" unless it is already data or auth. Hidden edges are left out.
 */
function addCalls(folder: string, report: TaskReport, scan: ReturnType<typeof scanSystem>): void {
  const hidden = reviewState(readReview(folder)).hiddenEdges;
  const edges = edgesIn(
    folder,
    scan.repos.map((r) => r.dir),
    scan.parts,
  ).filter((e) => !hidden.has(e.id));
  for (const line of report.lines) {
    const mine = edges.filter((e) => e.evidence.startsWith(`${line.file}:`));
    if (!mine.length) continue;
    line.calls = [
      ...new Set(
        mine.map(
          (e) =>
            `${"repo" in e.to ? e.to.repo : e.to.name} ${e.method ? `${e.method} ` : ""}${e.route}`,
        ),
      ),
    ];
    if (line.category !== "data" && line.category !== "auth") line.category = "calls";
  }
  const rank = (c: string) => CATEGORY_ORDER.indexOf(c as (typeof CATEGORY_ORDER)[number]);
  report.lines.sort(
    (a, b) =>
      rank(a.category) - rank(b.category) ||
      a.repo.localeCompare(b.repo) ||
      a.file.localeCompare(b.file),
  );
}
