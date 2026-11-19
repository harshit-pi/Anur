import { mkdirSync, readdirSync, readFileSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { tasksDir, type TaskReport } from "@anur/system";

/**
 * The folder's task reports (group 21), written by the hooks in Claude Code
 * to `.anur/tasks/`. Main reads them for the System tab and the task tab,
 * and watches the folder so a new report shows without a click.
 */

const ID = /^[\w.-]+$/;

export function listReports(folder: string, max = 50): TaskReport[] {
  let names: string[];
  try {
    names = readdirSync(tasksDir(folder)).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const out: TaskReport[] = [];
  for (const n of names.sort().reverse().slice(0, max)) {
    const r = readReport(folder, n.slice(0, -5));
    if (r) out.push(r);
  }
  return out;
}

export function readReport(folder: string, id: string): TaskReport | null {
  if (!ID.test(id)) return null;
  try {
    const r = JSON.parse(
      readFileSync(path.join(tasksDir(folder), `${id}.json`), "utf8"),
    ) as TaskReport;
    return Array.isArray(r.lines)
      ? { ...r, choices: Array.isArray(r.choices) ? r.choices : [] }
      : null;
  } catch {
    return null;
  }
}

/** One watcher per folder, started when its reports are first read. */
export class ReportWatch {
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly changed: (folder: string) => void;
  constructor(changed: (folder: string) => void) {
    this.changed = changed;
  }

  ensure(folder: string): void {
    if (this.watchers.has(folder)) return;
    try {
      mkdirSync(tasksDir(folder), { recursive: true });
      let timer: ReturnType<typeof setTimeout> | null = null;
      const w = watch(tasksDir(folder), (_e, name) => {
        if (!name?.toString().endsWith(".json")) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          this.changed(folder);
        }, 200);
      });
      w.on("error", () => {
        this.watchers.delete(folder);
      });
      this.watchers.set(folder, w);
    } catch {
      // A read-only folder: reports show on the next read.
    }
  }

  stop(): void {
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
  }
}
