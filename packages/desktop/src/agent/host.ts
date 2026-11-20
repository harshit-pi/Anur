import { latestModels } from "./latest-models.ts";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { AGENTS, type AgentId } from "../shared/agents.ts";
import type { AgentAdapter } from "./adapters.ts";
import { checkedIn, hookSaw, toolsSeen } from "./check-log.ts";
import type { Launch } from "./adapters.ts";
import type {
  AgentAuth,
  AgentVersions,
  SessionOption,
  SessionSpec,
  ToHost,
  ToMain,
} from "./protocol.ts";
import { selfTest } from "./self-test.ts";

/**
 * The agent host (task 3.1): Anur as an ACP client of the person's own
 * agents, one session per thread. It speaks ACP to every agent the same
 * way; each agent's adapter says how to start it and how to give it Anur's
 * guard. It runs in its own utilityProcess; main sends it `ToHost` messages
 * and routes its `ToMain` ones.
 *
 * Threads run only while the thread check passes (3.2): the hook passes its
 * sample calls before an agent connects, every session's start hook checks
 * in before the first prompt, and every tool call the agent reports as done
 * passed through the hook. A miss stops the turn and that agent's threads,
 * until the check passes again.
 */

export type HostEnv = {
  /** A Node to run the hook's self-test with: Electron itself, run as Node. */
  node: string;
  nodeEnv: Record<string, string>;
  /** Anur's hook program, which the self-test runs before an agent connects. */
  hook: string;
  /** The agents Anur can drive, by ID. */
  adapters: Partial<Record<AgentId, AgentAdapter>>;
};

type Turn = { thread: string; turn: string };

type Connected = {
  kind: "connected";
  conn: acp.ClientConnection;
  child: ChildProcess;
  versions: AgentVersions;
  /** How it was started, for running its sign-ins the same way. */
  launch: Launch;
  /** The sign-ins its adapter offered at initialize: arguments to its own command. */
  signIns: { id: string; name: string; description: string | null; args: string[] }[];
};

type ConnectionState =
  { kind: "connecting"; ready: Promise<boolean> } | Connected | { kind: "failed"; reason: string };

/** How long a session stays after its last turn before the limit may close it; checks can shorten it. */
const QUIET_MS = Number(process.env.ANUR_SESSION_QUIET_MS ?? 2 * 60 * 1000);

/**
 * Which live sessions to close to get back to the limit (13.3): the ones
 * idle longest, never one with a turn running or one that finished a turn
 * within the quiet spell, since background work it started may still run.
 */
export function sessionsToClose(
  live: readonly string[],
  busy: ReadonlySet<string>,
  lastUsed: ReadonlyMap<string, number>,
  limit: number,
  now: number,
  quietMs: number,
): string[] {
  const over = live.length - limit;
  if (over <= 0) return [];
  return live
    .filter((t) => !busy.has(t) && now - (lastUsed.get(t) ?? 0) >= quietMs)
    .sort((a, b) => (lastUsed.get(a) ?? 0) - (lastUsed.get(b) ?? 0))
    .slice(0, over);
}

export class AgentHost {
  /** One connection per agent, started when a thread first needs it. */
  private readonly agents = new Map<AgentId, ConnectionState>();
  /** Each thread's live session, and the agent it runs on. */
  private readonly sessions = new Map<string, { agent: AgentId; id: string }>();
  /** The turn running in each session, so updates reach the right thread. */
  private readonly running = new Map<string, Turn>();
  private readonly permissions = new Map<string, (option: string | null) => void>();
  /** Past this many live sessions, idle ones close; each reopens on its thread's next message (13.3). */
  private limit = 8;
  /** When each thread last started or finished a turn, to close the longest idle first. */
  private readonly lastUsed = new Map<string, number>();
  /** Spare sessions opened ahead, not yet taken by a thread's first message. */
  private readonly warmed = new Set<string>();
  /** Each session's mode and model as last reported, to repeat when a spare is taken. */
  private readonly lastOptions = new Map<string, SessionOption[]>();
  /** Spare sessions still opening. */
  private readonly warming = new Set<string>();
  /** Each session's hook log, to match its tool calls against. */
  private readonly hookLogs = new Map<string, string>();
  /** Tool calls each Kiro session finished, matched by count against the hook log. */
  private readonly callsDone = new Map<string, number>();
  /** Each thread's chosen mode and model, applied to its session whenever one starts. */
  private readonly chosen = new Map<string, Map<string, string>>();
  /** A sign-in running for an agent. */
  private readonly signingIn = new Map<AgentId, ChildProcess>();

  constructor(
    private readonly send: (m: ToMain) => void,
    private readonly env: HostEnv,
  ) {
    // A session past the limit that was still busy closes once it has gone quiet.
    setInterval(() => {
      void this.trim();
    }, 60_000).unref();
  }

  handle(m: ToHost): void {
    switch (m.type) {
      case "connect":
        void this.connect(m.agent);
        return;
      case "probe":
        void this.probe(m.agent, m.cwd);
        return;
      case "auth":
        void this.auth(m.agent);
        return;
      case "sign-in":
        this.signIn(m.agent, m.method);
        return;
      case "sign-in-cancel":
        this.signingIn.get(m.agent)?.kill();
        return;
      case "prompt":
        void this.prompt(m.spec, m.turn, m.text);
        return;
      case "cancel":
        void this.cancel(m.thread);
        return;
      case "permission":
        this.permissions.get(m.request)?.(m.option);
        this.permissions.delete(m.request);
        return;
      case "close":
        // The thread is gone: its running turn stops and its session ends in the agent (13.5).
        if (this.warmed.has(m.thread)) void this.closeWarm(m.thread);
        else void this.endSession(m.thread, true);
        this.chosen.delete(m.thread);
        this.lastOptions.delete(m.thread);
        return;
      case "limit":
        this.limit = Math.max(1, Math.floor(m.max));
        void this.trim();
        return;
      case "warm":
        void this.warm(m.spec);
        return;
      case "option":
        void this.setOption(m.thread, m.id, m.value);
        return;
    }
  }

  private connected(agent: AgentId): Connected | null {
    const s = this.agents.get(agent);
    return s?.kind === "connected" ? s : null;
  }

  /** Start the agent's adapter once; later calls wait for the same start. */
  connect(agent: AgentId): Promise<boolean> {
    const s = this.agents.get(agent);
    if (s?.kind === "connected") return Promise.resolve(true);
    if (s?.kind === "connecting") return s.ready;
    const ready = this.start(agent).then(
      (ok) => ok,
      (e: unknown) =>
        this.fail(agent, `The agent didn't start: ${e instanceof Error ? e.message : String(e)}`),
    );
    this.agents.set(agent, { kind: "connecting", ready });
    return ready;
  }

  private fail(agent: AgentId, reason: string): false {
    this.agents.set(agent, { kind: "failed", reason });
    this.send({ type: "status", id: agent, connected: false, reason, agent: null });
    return false;
  }

  private async start(agent: AgentId): Promise<boolean> {
    const adapter = this.env.adapters[agent];
    if (!adapter)
      return this.fail(agent, AGENTS[agent].why ?? `${AGENTS[agent].name} can't run threads yet.`);
    const failed = selfTest(this.env.node, this.env.nodeEnv, this.env.hook, adapter.hookFlavor);
    if (failed)
      return this.fail(
        agent,
        `Threads are off: Anur's safety check failed, because ${failed}. Nothing was sent to the agent.`,
      );
    const launch = await adapter.launch();
    if ("fail" in launch) return this.fail(agent, launch.fail);
    const child = spawn(launch.command, launch.args, {
      env: { ...process.env, ...launch.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-4000);
    });
    child.on("exit", (code) => {
      if (this.connected(agent)?.child !== child) return;
      for (const [thread, live] of this.sessions) {
        if (live.agent !== agent) continue;
        const t = this.running.get(live.id);
        if (t) this.send({ type: "error", thread, turn: t.turn, message: "The agent stopped." });
        this.running.delete(live.id);
        this.sessions.delete(thread);
      }
      this.report();
      this.fail(
        agent,
        `The agent stopped (exit ${String(code)}). ${stderr.trim().split("\n").at(-1) ?? ""}`,
      );
    });
    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>,
    );
    const app = acp
      .client({ name: "anur" })
      .onNotification(acp.methods.client.session.update, ({ params }) => {
        this.onUpdate(agent, params);
      })
      .onRequest(acp.methods.client.session.requestPermission, ({ params }) =>
        this.askPermission(params),
      )
      // ACP's auth extension is unstable, so it is called by name.
      .onNotification(
        "auth/status_update",
        (raw: unknown) => raw,
        ({ params }) => {
          this.sendAuth(agent, params);
        },
      );
    const conn = app.connect(stream);
    const init = await conn.agent.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      // No client file system or terminal: the agent uses its own tools at full power.
      // Sign-ins are run by Anur as commands, so the adapter lists them (3.16).
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
        auth: { terminal: true },
        ...(adapter.clientMeta ? { _meta: adapter.clientMeta } : {}),
      },
    });
    const signIns = (init.authMethods ?? []).flatMap((m) => {
      const raw = m as {
        id?: unknown;
        name?: unknown;
        description?: unknown;
        type?: unknown;
        args?: unknown;
      };
      return raw.type === "terminal" && typeof raw.id === "string" && Array.isArray(raw.args)
        ? [
            {
              id: raw.id,
              name: typeof raw.name === "string" ? raw.name : raw.id,
              description: typeof raw.description === "string" ? raw.description.trim() : null,
              args: raw.args.filter((a): a is string => typeof a === "string"),
            },
          ]
        : [];
    });
    const versions = {
      agent: launch.version ?? init.agentInfo?.version ?? "unknown",
      adapter: adapter.adapterVersion,
    };
    this.agents.set(agent, { kind: "connected", conn, child, versions, launch, signIns });
    this.send({ type: "status", id: agent, connected: true, reason: null, agent: versions });
    return true;
  }

  /**
   * A session opened ahead for a thread that doesn't exist yet: the thread's
   * first message then skips the session's start (about a third of a second).
   * Main reserves the thread's ID and sends its spec; nothing runs in it.
   */
  private async warm(spec: SessionSpec): Promise<void> {
    if (this.sessions.has(spec.thread)) return;
    if (!(await this.connect(spec.agent))) return;
    const c = this.connected(spec.agent);
    if (!c) return;
    this.warming.add(spec.thread);
    try {
      await this.session(c, spec);
      this.warmed.add(spec.thread);
    } catch {
      // The thread's first message opens its session, as before.
      this.sessions.delete(spec.thread);
    } finally {
      this.warming.delete(spec.thread);
    }
  }

  /** A spare session no thread took: closed, so its agent process ends. */
  private async closeWarm(thread: string): Promise<void> {
    const live = this.sessions.get(thread);
    this.warmed.delete(thread);
    const c = live ? this.connected(live.agent) : null;
    if (live && c)
      await c.conn.agent
        .request(acp.methods.agent.session.close, { sessionId: live.id })
        .catch(() => undefined);
  }

  /** Live sessions, not counting spares opened ahead. */
  private liveThreads(): string[] {
    return [...this.sessions.keys()].filter((t) => !this.warmed.has(t));
  }

  private report(): void {
    this.send({ type: "sessions", live: this.liveThreads().length });
  }

  /**
   * End a thread's session in its agent: its turn cancelled first when asked,
   * as when the thread closes. Its ID stays in the thread, so it can resume.
   */
  private async endSession(thread: string, cancelTurn: boolean): Promise<void> {
    const live = this.sessions.get(thread);
    this.sessions.delete(thread);
    this.lastUsed.delete(thread);
    this.report();
    const c = live ? this.connected(live.agent) : null;
    if (!live || !c) return;
    if (cancelTurn && this.running.has(live.id)) await this.cancelSession(thread, live, c);
    await c.conn.agent
      .request(acp.methods.agent.session.close, { sessionId: live.id })
      .catch(() => undefined);
  }

  /**
   * Past the limit, close the sessions idle longest. A session with a turn
   * running, or one that finished within the quiet spell, stays: background
   * work it started may still be going.
   */
  private async trim(now = Date.now()): Promise<void> {
    const busy = new Set([...this.running.values()].map((t) => t.thread));
    const close = sessionsToClose(
      this.liveThreads(),
      busy,
      this.lastUsed,
      this.limit,
      now,
      QUIET_MS,
    );
    for (const thread of close) await this.endSession(thread, false);
  }

  private async session(c: Connected, spec: SessionSpec): Promise<string> {
    // A spare still opening: wait for it rather than open a second session.
    for (let i = 0; i < 100 && this.warming.has(spec.thread); i++)
      await new Promise((r) => setTimeout(r, 50));
    const live = this.sessions.get(spec.thread);
    if (live?.agent === spec.agent) {
      if (this.warmed.delete(spec.thread))
        // The spare is this thread's now: main records its session, as for a new one.
        this.send({
          type: "session",
          thread: spec.thread,
          session: live.id,
          agent: spec.agent,
          event: "started",
        });
      // Its mode and model, which main didn't hear while no thread had this ID.
      const options = this.lastOptions.get(spec.thread);
      if (options) this.send({ type: "options", thread: spec.thread, options });
      return live.id;
    }
    const adapter = this.env.adapters[spec.agent];
    if (!adapter) throw new Error(`${AGENTS[spec.agent].name} can't run threads yet.`);
    const meta = adapter.sessionMeta(spec.guard);
    const { conn } = c;
    if (spec.resume) {
      let loaded: unknown;
      try {
        loaded = await conn.agent.request(acp.methods.agent.session.load, {
          sessionId: spec.resume,
          cwd: spec.cwd,
          mcpServers: mcpOf(spec),
          _meta: meta,
        });
      } catch {
        throw new ResumeFailed();
      }
      await this.opened(
        conn,
        spec,
        spec.resume,
        (loaded as { configOptions?: unknown } | null)?.configOptions ?? null,
      );
      this.send({
        type: "session",
        thread: spec.thread,
        session: spec.resume,
        agent: spec.agent,
        event: "resumed",
      });
      return spec.resume;
    }
    const created = await conn.agent
      .request(acp.methods.agent.session.new, {
        cwd: spec.cwd,
        mcpServers: mcpOf(spec),
        _meta: meta,
      })
      .catch((e: unknown) => {
        throw signInRequired(e) ? new SignInRequired() : e;
      });
    await this.opened(conn, spec, created.sessionId, created.configOptions ?? null);
    this.send({
      type: "session",
      thread: spec.thread,
      session: created.sessionId,
      agent: spec.agent,
      event: "started",
    });
    return created.sessionId;
  }

  /**
   * A session is open: its start hook must have checked in, or the hooks
   * aren't running and the thread must not start. Then the thread's chosen
   * mode and model are set.
   */
  private async opened(
    conn: acp.ClientConnection,
    spec: SessionSpec,
    sessionId: string,
    options: unknown,
  ): Promise<void> {
    const adapter = this.env.adapters[spec.agent];
    await adapter?.bindSession?.(sessionId, spec.guard);
    // Kiro runs its start hook with the session's first prompt, not before: its
    // check-in is checked with each finished tool call instead (matchCall).
    const later = adapter?.hookFlavor === "kiro";
    if (!later && !(await checkedIn(adapter?.startLog ?? spec.hookLog, sessionId))) {
      await conn.agent
        .request(acp.methods.agent.session.close, { sessionId })
        .catch(() => undefined);
      throw new CheckFailed(
        "Anur's hook didn't check in when the session started, so the thread can't keep other threads out. A setting may turn hooks off, such as disableAllHooks or allowManagedHooksOnly.",
      );
    }
    this.sessions.set(spec.thread, { agent: spec.agent, id: sessionId });
    this.lastUsed.set(spec.thread, Date.now());
    this.report();
    void this.trim();
    this.hookLogs.set(sessionId, spec.hookLog);
    let current = optionsOf(options);
    for (const [id, value] of this.chosen.get(spec.thread) ?? []) {
      const res = await conn.agent
        .request(acp.methods.agent.session.setConfigOption, { sessionId, configId: id, value })
        .catch(() => null);
      if (res) current = optionsOf(res.configOptions);
    }
    this.lastOptions.set(spec.thread, current);
    this.send({ type: "options", thread: spec.thread, options: current });
  }

  /**
   * The agent's mode and model choices, before any thread has a session: a
   * session is opened and closed again at once. No prompt is sent, so no
   * model runs and no tool can be called.
   */
  private async probe(agent: AgentId, cwd: string): Promise<void> {
    if (!(await this.connect(agent))) return;
    const c = this.connected(agent);
    if (!c) return;
    try {
      const s = await c.conn.agent.request(acp.methods.agent.session.new, { cwd, mcpServers: [] });
      await c.conn.agent
        .request(acp.methods.agent.session.close, { sessionId: s.sessionId })
        .catch(() => undefined);
      this.send({ type: "agent-options", agent, options: optionsOf(s.configOptions ?? null) });
    } catch {
      // The choices then come with the thread's first session, as before.
    }
  }

  /** Whether the agent is signed in, with the sign-ins it offers. */
  private async auth(agent: AgentId): Promise<void> {
    if (!(await this.connect(agent))) return;
    const c = this.connected(agent);
    if (!c) return;
    const res = await c.conn.agent.request("auth/status", {}).catch(() => ({ state: "unknown" }));
    this.sendAuth(agent, res);
  }

  private sendAuth(agent: AgentId, raw: unknown): void {
    const c = this.connected(agent);
    const r = raw as { state?: unknown; accounts?: { label?: unknown; email?: unknown }[] };
    const state =
      r.state === "authenticated" || r.state === "unauthenticated" ? r.state : "unknown";
    const a = r.accounts?.[0];
    const auth: AgentAuth = {
      state,
      account:
        typeof a?.email === "string" ? a.email : typeof a?.label === "string" ? a.label : null,
      methods: (c?.signIns ?? []).map(({ id, name, description }) => ({ id, name, description })),
    };
    this.send({ type: "auth", agent, auth });
  }

  /**
   * Run one of the agent's sign-ins, as its adapter describes it: its own
   * command with the method's arguments, here without a terminal. It opens
   * the browser; the page is passed on too, in case it doesn't open. Once it
   * finishes, the agent restarts, so new sessions use the new sign-in.
   */
  private signIn(agent: AgentId, method: string): void {
    const c = this.connected(agent);
    const m = c?.signIns.find((x) => x.id === method);
    if (!c || !m || this.signingIn.has(agent)) return;
    const child = spawn(c.launch.command, [...c.launch.args, ...m.args], {
      env: { ...process.env, ...c.launch.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.signingIn.set(agent, child);
    let out = "";
    let url: string | null = null;
    const read = (d: Buffer) => {
      out = (out + d.toString()).slice(-8000);
      const found = /https:\/\/\S+/.exec(out)?.[0] ?? null;
      if (found && !url) {
        url = found;
        this.send({ type: "sign-in", agent, phase: "waiting", url, message: null });
      }
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    this.send({ type: "sign-in", agent, phase: "waiting", url: null, message: null });
    child.on("exit", (code) => {
      this.signingIn.delete(agent);
      if (code === 0) {
        // A fresh start, so the agent and its new sessions read the new sign-in.
        this.connected(agent)?.child.kill();
        this.agents.delete(agent);
        void this.auth(agent);
        return;
      }
      const last = out.trim().split("\n").filter(Boolean).at(-1) ?? null;
      this.send({
        type: "sign-in",
        agent,
        phase: "failed",
        url: null,
        message:
          code === null ? "Sign-in stopped." : (last ?? `Sign-in ended (exit ${String(code)}).`),
      });
      void this.auth(agent);
    });
  }

  /** The person picked a mode or model for the thread. */
  private async setOption(thread: string, id: string, value: string): Promise<void> {
    const mine = this.chosen.get(thread) ?? new Map<string, string>();
    mine.set(id, value);
    this.chosen.set(thread, mine);
    const live = this.sessions.get(thread);
    const c = live ? this.connected(live.agent) : null;
    if (!live || !c) return;
    const res = await c.conn.agent
      .request(acp.methods.agent.session.setConfigOption, {
        sessionId: live.id,
        configId: id,
        value,
      })
      .catch(() => null);
    if (res) {
      this.lastOptions.set(thread, optionsOf(res.configOptions));
      this.send({ type: "options", thread, options: optionsOf(res.configOptions) });
    }
  }

  private async prompt(spec: SessionSpec, turn: string, text: string): Promise<void> {
    const fail = (message: string) => {
      this.send({ type: "error", thread: spec.thread, turn, message });
    };
    // A thread moved to another agent leaves its old session; its choices were that agent's.
    const before = this.sessions.get(spec.thread);
    if (before && before.agent !== spec.agent) {
      this.sessions.delete(spec.thread);
      this.chosen.delete(spec.thread);
    }
    const ok = await this.connect(spec.agent);
    const c = this.connected(spec.agent);
    if (!ok || !c) {
      const s = this.agents.get(spec.agent);
      fail(s?.kind === "failed" ? s.reason : "The agent isn't connected.");
      return;
    }
    let sessionId: string;
    try {
      sessionId = await this.session(c, spec);
    } catch (e) {
      if (e instanceof SignInRequired) {
        fail("sign-in-required");
        void this.auth(spec.agent);
      } else if (e instanceof ResumeFailed) fail("resume-failed");
      else if (e instanceof CheckFailed) {
        fail(e.message);
        this.fail(spec.agent, e.message);
      } else fail(`The agent couldn't start this thread: ${messageOf(e)}`);
      return;
    }
    this.running.set(sessionId, { thread: spec.thread, turn });
    this.lastUsed.set(spec.thread, Date.now());
    try {
      const res = await c.conn.agent.request(acp.methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: "text", text }],
      });
      const u = (res as { usage?: Record<string, number | undefined> | null }).usage;
      this.send({
        type: "turn-end",
        thread: spec.thread,
        turn,
        stopReason: res.stopReason,
        usage: u
          ? {
              input: u.inputTokens ?? 0,
              output: u.outputTokens ?? 0,
              cacheRead: u.cachedReadTokens ?? 0,
              cacheWrite: u.cachedWriteTokens ?? 0,
            }
          : null,
      });
    } catch (e) {
      if (signInRequired(e)) {
        fail("sign-in-required");
        void this.auth(spec.agent);
      } else fail(messageOf(e));
    } finally {
      this.running.delete(sessionId);
      if (this.sessions.has(spec.thread)) this.lastUsed.set(spec.thread, Date.now());
    }
  }

  private async cancel(thread: string): Promise<void> {
    const live = this.sessions.get(thread);
    const c = live ? this.connected(live.agent) : null;
    if (!live || !c) return;
    await this.cancelSession(thread, live, c);
  }

  private async cancelSession(
    thread: string,
    live: { agent: AgentId; id: string },
    c: Connected,
  ): Promise<void> {
    for (const [id, resolve] of this.permissions) {
      if (id.startsWith(`${thread}:`)) {
        resolve(null);
        this.permissions.delete(id);
      }
    }
    await c.conn.agent.notify(acp.methods.agent.session.cancel, { sessionId: live.id });
  }

  private onUpdate(agent: AgentId, params: acp.SessionNotification): void {
    const t = this.running.get(params.sessionId);
    if (!t) return;
    const u = params.update;
    if (u.sessionUpdate === "agent_message_chunk" && u.content.type === "text") {
      this.send({ type: "text", ...t, text: u.content.text });
    } else if (u.sessionUpdate === "tool_call" || u.sessionUpdate === "tool_call_update") {
      this.send({
        type: "tool",
        ...t,
        toolUse: u.toolCallId,
        title: u.title ?? "",
        kind: u.kind ?? null,
        status: u.status ?? "pending",
        input: u.rawInput ?? null,
        name:
          ((u._meta as { claudeCode?: { toolName?: unknown } } | null | undefined)?.claudeCode
            ?.toolName as string | undefined) ?? null,
        output: u.rawOutput ?? null,
      });
      if (u.status === "completed") void this.matchCall(agent, params.sessionId, t, u.toolCallId);
    } else if (u.sessionUpdate === "config_option_update") {
      this.send({ type: "options", thread: t.thread, options: optionsOf(u.configOptions) });
    } else if ((u.sessionUpdate as string) === "usage_update") {
      // How full the session's context is, and the model's window (4.9).
      const { used, size } = u as unknown as { used?: unknown; size?: unknown };
      if (typeof used === "number" && typeof size === "number" && size > 0)
        this.send({ type: "context", ...t, used, size });
    }
  }

  /** A tool call the agent finished must have passed through the hook first. */
  private async matchCall(
    agent: AgentId,
    sessionId: string,
    t: Turn,
    toolUse: string,
  ): Promise<void> {
    const log = this.hookLogs.get(sessionId);
    if (!log) return;
    const adapter = this.env.adapters[agent];
    if (adapter?.hookFlavor === "kiro") {
      // Kiro's hook input names no call: every finished call needs one the hook saw.
      const done = (this.callsDone.get(sessionId) ?? 0) + 1;
      this.callsDone.set(sessionId, done);
      const start = adapter.startLog;
      const started = !start || (await checkedIn(start, sessionId, 2000));
      if (started && (await toolsSeen(log, sessionId)) >= done) return;
    } else if (await hookSaw(log, toolUse)) return;
    const reason =
      "A tool call ran without passing through Anur's hook, so the turn stopped and threads are off until the check passes again.";
    const c = this.connected(agent);
    if (c) await c.conn.agent.notify(acp.methods.agent.session.cancel, { sessionId });
    this.send({ type: "error", thread: t.thread, turn: t.turn, message: reason });
    this.running.delete(sessionId);
    for (const [thread, live] of this.sessions)
      if (live.agent === agent) this.sessions.delete(thread);
    this.report();
    c?.child.kill();
    this.fail(agent, reason);
  }

  private askPermission(
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    const t = this.running.get(params.sessionId);
    if (!t) return Promise.resolve({ outcome: { outcome: "cancelled" } });
    // Anur's own tools are the thread talking to Anur, never something to ask
    // the person about, in any mode (plan mode asks for every MCP tool).
    const own = (params.toolCall.title ?? "").startsWith("mcp__anur__");
    const allow =
      params.options.find((o) => o.kind === "allow_once") ??
      params.options.find((o) => o.kind.startsWith("allow"));
    if (own && allow)
      return Promise.resolve({ outcome: { outcome: "selected", optionId: allow.optionId } });
    const request = `${t.thread}:${randomBytes(6).toString("hex")}`;
    return new Promise((resolve) => {
      this.permissions.set(request, (option) => {
        resolve(
          option
            ? { outcome: { outcome: "selected", optionId: option } }
            : { outcome: { outcome: "cancelled" } },
        );
      });
      this.send({
        type: "permission",
        thread: t.thread,
        request,
        title: params.toolCall.title ?? "The agent asks to continue",
        options: params.options.map((o) => ({ id: o.optionId, name: o.name, kind: o.kind })),
        plan: (() => {
          const raw = params.toolCall.rawInput as { plan?: unknown } | null | undefined;
          return typeof raw?.plan === "string" ? raw.plan : null;
        })(),
      });
    });
  }
}

class ResumeFailed extends Error {}

/** Anur's own MCP server for the session, when it has one. */
const mcpOf = (spec: SessionSpec): acp.McpServer[] =>
  spec.mcp
    ? [{ name: "anur", command: spec.mcp.command, args: spec.mcp.args, env: spec.mcp.env }]
    : [];
class SignInRequired extends Error {}

/** ACP's "auth required": the agent isn't signed in. */
const signInRequired = (e: unknown) =>
  typeof e === "object" &&
  e !== null &&
  (e as { code?: unknown }).code === acp.RequestError.authRequired().code;
class CheckFailed extends Error {}

/** The mode and model choices from ACP's session config options. */
function optionsOf(raw: unknown): SessionOption[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[]).flatMap((o) => {
    if (o.type !== "select" || (o.category !== "mode" && o.category !== "model")) return [];
    const choices = Array.isArray(o.options)
      ? (o.options as Record<string, unknown>[]).flatMap((c) =>
          typeof c.value === "string"
            ? [
                {
                  value: c.value,
                  name: typeof c.name === "string" ? c.name : c.value,
                  description: typeof c.description === "string" ? c.description : null,
                },
              ]
            : [],
        )
      : [];
    return typeof o.id === "string" && typeof o.currentValue === "string"
      ? [
          {
            id: o.id,
            name: typeof o.name === "string" ? o.name : o.id,
            current: o.currentValue,
            // Only the newest model of each family; the current one always stays.
            choices: o.category === "model" ? latestModels(choices, o.currentValue) : choices,
          },
        ]
      : [];
  });
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
