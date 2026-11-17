import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { AGENTS, type AgentId } from "../shared/agents.ts";
import type { AgentAdapter } from "./adapters.ts";
import { checkedIn, hookSaw } from "./check-log.ts";
import type { AgentVersions, SessionOption, SessionSpec, ToHost, ToMain } from "./protocol.ts";
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
};

type ConnectionState =
  { kind: "connecting"; ready: Promise<boolean> } | Connected | { kind: "failed"; reason: string };

export class AgentHost {
  /** One connection per agent, started when a thread first needs it. */
  private readonly agents = new Map<AgentId, ConnectionState>();
  /** Each thread's live session, and the agent it runs on. */
  private readonly sessions = new Map<string, { agent: AgentId; id: string }>();
  /** The turn running in each session, so updates reach the right thread. */
  private readonly running = new Map<string, Turn>();
  private readonly permissions = new Map<string, (option: string | null) => void>();
  /** Each session's hook log, to match its tool calls against. */
  private readonly hookLogs = new Map<string, string>();
  /** Each thread's chosen mode and model, applied to its session whenever one starts. */
  private readonly chosen = new Map<string, Map<string, string>>();

  constructor(
    private readonly send: (m: ToMain) => void,
    private readonly env: HostEnv,
  ) {}

  handle(m: ToHost): void {
    switch (m.type) {
      case "connect":
        void this.connect(m.agent);
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
        this.sessions.delete(m.thread);
        this.chosen.delete(m.thread);
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
    const failed = selfTest(this.env.node, this.env.nodeEnv, this.env.hook);
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
      );
    const conn = app.connect(stream);
    const init = await conn.agent.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      // No client file system or terminal: the agent uses its own tools at full power.
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    });
    const versions = {
      agent: launch.version ?? init.agentInfo?.version ?? "unknown",
      adapter: adapter.adapterVersion,
    };
    this.agents.set(agent, { kind: "connected", conn, child, versions });
    this.send({ type: "status", id: agent, connected: true, reason: null, agent: versions });
    return true;
  }

  private async session(c: Connected, spec: SessionSpec): Promise<string> {
    const live = this.sessions.get(spec.thread);
    if (live?.agent === spec.agent) return live.id;
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
          mcpServers: [],
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
    const created = await conn.agent.request(acp.methods.agent.session.new, {
      cwd: spec.cwd,
      mcpServers: [],
      _meta: meta,
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
    if (!(await checkedIn(spec.hookLog, sessionId))) {
      await conn.agent
        .request(acp.methods.agent.session.close, { sessionId })
        .catch(() => undefined);
      throw new CheckFailed(
        "Anur's hook didn't check in when the session started, so the thread can't keep other threads out. A setting may turn hooks off, such as disableAllHooks or allowManagedHooksOnly.",
      );
    }
    this.sessions.set(spec.thread, { agent: spec.agent, id: sessionId });
    this.hookLogs.set(sessionId, spec.hookLog);
    let current = optionsOf(options);
    for (const [id, value] of this.chosen.get(spec.thread) ?? []) {
      const res = await conn.agent
        .request(acp.methods.agent.session.setConfigOption, { sessionId, configId: id, value })
        .catch(() => null);
      if (res) current = optionsOf(res.configOptions);
    }
    this.send({ type: "options", thread: spec.thread, options: current });
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
    if (res) this.send({ type: "options", thread, options: optionsOf(res.configOptions) });
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
      if (e instanceof ResumeFailed) fail("resume-failed");
      else if (e instanceof CheckFailed) {
        fail(e.message);
        this.fail(spec.agent, e.message);
      } else fail(`The agent couldn't start this thread: ${messageOf(e)}`);
      return;
    }
    this.running.set(sessionId, { thread: spec.thread, turn });
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
      fail(messageOf(e));
    } finally {
      this.running.delete(sessionId);
    }
  }

  private async cancel(thread: string): Promise<void> {
    const live = this.sessions.get(thread);
    const c = live ? this.connected(live.agent) : null;
    if (!live || !c) return;
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
      });
      if (u.status === "completed") void this.matchCall(agent, params.sessionId, t, u.toolCallId);
    } else if (u.sessionUpdate === "config_option_update") {
      this.send({ type: "options", thread: t.thread, options: optionsOf(u.configOptions) });
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
    if (!log || (await hookSaw(log, toolUse))) return;
    const reason =
      "A tool call ran without passing through Anur's hook, so the turn stopped and threads are off until the check passes again.";
    const c = this.connected(agent);
    if (c) await c.conn.agent.notify(acp.methods.agent.session.cancel, { sessionId });
    this.send({ type: "error", thread: t.thread, turn: t.turn, message: reason });
    this.running.delete(sessionId);
    for (const [thread, live] of this.sessions)
      if (live.agent === agent) this.sessions.delete(thread);
    c?.child.kill();
    this.fail(agent, reason);
  }

  private askPermission(
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    const t = this.running.get(params.sessionId);
    if (!t) return Promise.resolve({ outcome: { outcome: "cancelled" } });
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
      });
    });
  }
}

class ResumeFailed extends Error {}
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
            choices,
          },
        ]
      : [];
  });
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
