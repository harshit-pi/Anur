/**
 * Claude Code's hooks for task boundaries (21.2): `UserPromptSubmit` marks
 * every repo in the opened folder; `Stop` compares with the mark and writes
 * the report. A hook never fails the agent: any error is swallowed and said
 * on stderr, which Claude Code shows only in verbose mode.
 */
import { rmSync } from "node:fs";
import path from "node:path";
import { scanSystem } from "./system.ts";
import {
  folderFor,
  markTask,
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
  | { kind: "marked"; folder: string }
  | { kind: "nothing"; folder: string }
  | { kind: "reported"; folder: string; report: TaskReport; file: string };

/** Handles one hook call. `folder` overrides the folder found from `cwd`. */
export function handleHook(input: HookInput, folderOverride?: string): HookResult {
  const cwd = input.cwd ?? process.cwd();
  const folder = folderOverride ?? folderFor(cwd);
  if (!folder) return { kind: "skipped", why: "no folder opened in Anur above " + cwd };
  const session = input.session_id ?? "session";
  if (input.hook_event_name === "UserPromptSubmit") {
    saveMark(folder, markTask(folder, session, input.prompt ?? ""));
    return { kind: "marked", folder };
  }
  if (input.hook_event_name === "Stop") {
    const mark = readMark(folder, session);
    if (!mark) return { kind: "skipped", why: "no mark for this session" };
    const report = reportSince(folder, mark, scanSystem(folder).parts);
    // The next task starts from here, whatever this one did.
    rmSync(path.join(tasksDir(folder), "marks", `${session.replace(/[^\w-]/g, "_")}.json`), {
      force: true,
    });
    if (!report) return { kind: "nothing", folder };
    return { kind: "reported", folder, report, file: saveReport(folder, report) };
  }
  return { kind: "skipped", why: `not a task boundary: ${input.hook_event_name ?? "none"}` };
}
