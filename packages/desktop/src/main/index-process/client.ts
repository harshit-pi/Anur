import path from "node:path";
import { utilityProcess, type UtilityProcess } from "electron";
import type { FolderRead, FromIndex, ToIndex } from "./protocol.ts";

type Answer = Exclude<FromIndex, { type: "changed" }>;

/** The index process's entry, built beside main's own. */
export const indexEntry = (mainDir: string) => path.join(mainDir, "index-process.js");

/**
 * Main's side of the index process: started on first use, restarted on the
 * next request if it stops, one answer per request.
 */
export class IndexProcess {
  private proc: UtilityProcess | null = null;
  private next = 1;
  private readonly waiting = new Map<number, (r: Answer) => void>();

  constructor(
    private readonly entry: string,
    /** A folder's sections may have changed: a watcher saw a build file move. */
    private readonly onChanged: (folder: string) => void = () => undefined,
  ) {}

  sections(folder: string, plugins: string[], timeoutMs = 60_000): Promise<FolderRead> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error("Reading the folder took over a minute."));
      }, timeoutMs);
      this.waiting.set(id, (r) => {
        clearTimeout(timer);
        if (r.type === "sections") resolve(r.read);
        else reject(new Error(r.reason));
      });
      this.process().postMessage({ type: "sections", id, folder, plugins } satisfies ToIndex);
    });
  }

  stop(): void {
    this.proc?.kill();
    this.proc = null;
  }

  private process(): UtilityProcess {
    if (this.proc) return this.proc;
    const proc = utilityProcess.fork(this.entry, [], {
      serviceName: "Anur index",
      stdio: "pipe",
    });
    proc.stdout?.on("data", (d: Buffer) => {
      process.stdout.write(`[index] ${d.toString()}`);
    });
    proc.stderr?.on("data", (d: Buffer) => {
      process.stderr.write(`[index] ${d.toString()}`);
    });
    proc.on("message", (m: FromIndex) => {
      if (m.type === "changed") {
        this.onChanged(m.folder);
        return;
      }
      this.waiting.get(m.id)?.(m);
      this.waiting.delete(m.id);
    });
    proc.on("exit", (code) => {
      if (this.proc !== proc) return;
      this.proc = null;
      for (const [id, done] of this.waiting)
        done({ type: "failed", id, reason: `The index process stopped (exit ${String(code)}).` });
      this.waiting.clear();
    });
    this.proc = proc;
    return proc;
  }
}
