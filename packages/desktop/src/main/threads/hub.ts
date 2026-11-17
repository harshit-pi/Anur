import path from "node:path";
import { utilityProcess, type UtilityProcess } from "electron";
import type { AgentStatus } from "../../shared/ipc-contract.ts";
import type { ToHost, ToMain } from "../../agent/protocol.ts";

/**
 * Main's link to the agent host (Architecture, "Processes"). The host runs
 * in its own utilityProcess, started the first time a thread needs it and
 * again after it stops; main only routes its messages to the thread's folder.
 */
export class AgentHub {
  status: AgentStatus = { connected: null, reason: null, agent: null };
  private proc: UtilityProcess | null = null;
  private readonly routes = new Map<string, (m: ToMain) => void>();
  private readonly waiting: ((s: AgentStatus) => void)[] = [];

  constructor(
    private readonly entry: string,
    private readonly onStatus: (s: AgentStatus) => void,
  ) {}

  /** Messages for this thread go to `fn` until the thread is dropped. */
  route(thread: string, fn: (m: ToMain) => void): void {
    this.routes.set(thread, fn);
  }

  drop(thread: string): void {
    this.routes.delete(thread);
    this.send({ type: "close", thread });
  }

  send(m: ToHost): void {
    this.process().postMessage(m);
  }

  /** Connect the agent once; resolves with the status that follows. */
  connect(): Promise<AgentStatus> {
    if (this.status.connected === true) return Promise.resolve(this.status);
    return new Promise((resolve) => {
      this.waiting.push(resolve);
      this.send({ type: "connect" });
    });
  }

  stop(): void {
    this.proc?.kill();
    this.proc = null;
  }

  private process(): UtilityProcess {
    if (this.proc) return this.proc;
    const proc = utilityProcess.fork(this.entry, [], {
      serviceName: "Anur agent host",
      stdio: "pipe",
    });
    proc.stdout?.on("data", (d: Buffer) => {
      process.stdout.write(`[agent host] ${d.toString()}`);
    });
    proc.stderr?.on("data", (d: Buffer) => {
      process.stderr.write(`[agent host] ${d.toString()}`);
    });
    proc.on("message", (m: ToMain) => {
      this.receive(m);
    });
    proc.on("exit", (code) => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.setStatus({
        connected: false,
        reason: `The agent host stopped (exit ${String(code)}); it starts again with the next message.`,
        agent: null,
      });
    });
    this.proc = proc;
    return proc;
  }

  private receive(m: ToMain): void {
    if (m.type === "status") {
      this.setStatus({ connected: m.connected, reason: m.reason, agent: m.agent });
      return;
    }
    this.routes.get(m.thread)?.(m);
  }

  private setStatus(s: AgentStatus): void {
    this.status = s;
    this.onStatus(s);
    for (const w of this.waiting.splice(0)) w(s);
  }
}

/** The host's entry, built beside main's own. */
export const hostEntry = (mainDir: string) => path.join(mainDir, "agent-host.js");
export const hookEntry = (mainDir: string) => path.join(mainDir, "hook.js");
