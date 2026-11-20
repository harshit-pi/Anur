import path from "node:path";
import { app, utilityProcess, type UtilityProcess } from "electron";
import type { AgentId } from "../../shared/agents.ts";
import type { AgentStatus } from "../../shared/ipc-contract.ts";
import type { AgentAuth, SessionOption, ToHost, ToMain } from "../../agent/protocol.ts";

export type SignIn = { phase: "waiting" | "failed"; url: string | null; message: string | null };
export type AuthEvent = { agent: AgentId; auth: AgentAuth; signIn: SignIn | null };

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
    /** An agent's sign-in changed, or a sign-in moved on. */
    private readonly onAuth: (e: AuthEvent) => void = () => undefined,
  ) {}

  /** Sessions live in the agents, as the host last said (13.4). */
  private live = 0;
  /** Past this many, the host closes idle sessions (13.3). */
  private limit = 8;

  liveSessions(): number {
    return this.proc ? this.live : 0;
  }

  /** The host's process, whose children are the agents, for their memory. */
  hostPid(): number | null {
    return this.proc?.pid ?? null;
  }

  setLimit(max: number): void {
    this.limit = max;
    this.proc?.postMessage({ type: "limit", max } satisfies ToHost);
  }

  private readonly auths = new Map<AgentId, AgentAuth>();
  private readonly signIns = new Map<AgentId, SignIn>();

  /** Whether the agent is signed in, as last read; unknown until asked. */
  auth(agent: AgentId): AgentAuth {
    return this.auths.get(agent) ?? { state: "unknown", account: null, methods: [] };
  }

  signIn(agent: AgentId): SignIn | null {
    return this.signIns.get(agent) ?? null;
  }

  /** A sign-in finished, failed or was cancelled: nothing is under way. */
  clearSignIn(agent: AgentId): void {
    this.signIns.delete(agent);
  }

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
      // Where agents' own files live, such as Kiro's session bindings.
      // The app itself, not the host's helper: hooks installed in agents name main's.
      env: {
        ...process.env,
        ANUR_USER_DATA: app.getPath("userData"),
        ANUR_APP_EXEC: process.execPath,
      },
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
      this.live = 0;
      for (const id of this.statuses.keys())
        this.setStatus({
          id,
          connected: false,
          reason: `The agent host stopped (exit ${String(code)}); it starts again with the next message.`,
          agent: null,
        });
    });
    this.proc = proc;
    proc.postMessage({ type: "limit", max: this.limit } satisfies ToHost);
    return proc;
  }

  private receive(m: ToMain): void {
    if (m.type === "agent-options") {
      this.onChoices(m.agent, m.options);
      return;
    }
    if (m.type === "auth") {
      this.auths.set(m.agent, m.auth);
      // Signed in: whatever sign-in was showing is over.
      if (m.auth.state === "authenticated") this.signIns.delete(m.agent);
      this.onAuth({ agent: m.agent, auth: m.auth, signIn: this.signIns.get(m.agent) ?? null });
      return;
    }
    if (m.type === "sign-in") {
      const now = { phase: m.phase, url: m.url, message: m.message };
      this.signIns.set(m.agent, now);
      this.onAuth({ agent: m.agent, auth: this.auth(m.agent), signIn: now });
      return;
    }
    if (m.type === "status") {
      this.setStatus({ id: m.id, connected: m.connected, reason: m.reason, agent: m.agent });
      return;
    }
    if (m.type === "sessions") {
      this.live = m.live;
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
