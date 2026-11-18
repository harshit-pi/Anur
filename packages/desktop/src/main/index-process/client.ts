import path from "node:path";
import { utilityProcess, type UtilityProcess } from "electron";
import type { SourcedSection } from "@anur/core";
import type { FromIndex, ToIndex } from "./protocol.ts";

type Sources = { id: string; sections: SourcedSection[] }[];

/** The index process's entry, built beside main's own. */
export const indexEntry = (mainDir: string) => path.join(mainDir, "index-process.js");

/**
 * Main's side of the index process: started on first use, restarted on the
 * next request if it stops, one answer per request.
 */
export class IndexProcess {
  private proc: UtilityProcess | null = null;
  private next = 1;
  private readonly waiting = new Map<number, (r: FromIndex) => void>();

  constructor(private readonly entry: string) {}

  sections(folder: string, plugins: string[], timeoutMs = 60_000): Promise<Sources> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error("Reading the folder took over a minute."));
      }, timeoutMs);
      this.waiting.set(id, (r) => {
        clearTimeout(timer);
        if (r.type === "sections") resolve(r.sources);
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
