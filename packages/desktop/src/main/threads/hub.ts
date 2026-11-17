import path from "node:path";
import { utilityProcess, type UtilityProcess } from "electron";
import type { AgentId } from "../../shared/agents.ts";
import type { AgentStatus } from "../../shared/ipc-contract.ts";
import type { SessionOption, ToHost, ToMain } from "../../agent/protocol.ts";

/**
 * Main's link to the agent host (Architecture, "Processes"). The host runs
 * in its own utilityProcess, started the first time a thread needs it and
 * again after it stops; main only routes its messages to the thread's folder.
 */
export class AgentHub {
  /** Each agent's status, once Anur has tried to connect it. */
  private readonly statuses = new Map<AgentId, AgentStatus>();
  private proc: UtilityProcess | null = null;
  private readonly routes = new Map<string, (m: ToMain) => void>();
  private readonly waiting = new Map<AgentId, ((s: AgentStatus) => void)[]>();

  status(agent: AgentId): AgentStatus {
    return this.statuses.get(agent) ?? { id: agent, connected: null, reason: null, agent: null };
  }

  constructor(
    private readonly entry: string,
    private readonly onStatus: (s: AgentStatus) => void,
    /** An agent's choices, read before any thread of it had a session. */
    private readonly onChoices: (agent: AgentId, options: SessionOption[]) => void = () =>
      undefined,
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
  connect(agent: AgentId): Promise<AgentStatus> {
    const now = this.status(agent);
    if (now.connected === true) return Promise.resolve(now);
    return new Promise((resolve) => {
      this.waiting.set(agent, [...(this.waiting.get(agent) ?? []), resolve]);
      this.send({ type: "connect", agent });
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
      for (const id of this.statuses.keys())
        this.setStatus({
          id,
          connected: false,
          reason: `The agent host stopped (exit ${String(code)}); it starts again with the next message.`,
          agent: null,
        });
    });
    this.proc = proc;
    return proc;
  }

  private receive(m: ToMain): void {
    if (m.type === "agent-options") {
      this.onChoices(m.agent, m.options);
      return;
    }
    if (m.type === "status") {
      this.setStatus({ id: m.id, connected: m.connected, reason: m.reason, agent: m.agent });
      return;
    }
    this.routes.get(m.thread)?.(m);
  }

  private setStatus(s: AgentStatus): void {
    this.statuses.set(s.id, s);
    this.onStatus(s);
    for (const w of this.waiting.get(s.id) ?? []) w(s);
    this.waiting.delete(s.id);
  }
}

/** The host's entry, built beside main's own. */
export const hostEntry = (mainDir: string) => path.join(mainDir, "agent-host.js");
export const hookEntry = (mainDir: string) => path.join(mainDir, "hook.js");
