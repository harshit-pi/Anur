import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { AgentVersions, SessionSpec, ToHost, ToMain } from "./protocol.ts";

/**
 * The agent host (task 3.1): Anur as an ACP client of the person's own
 * Claude Code, one session per thread. It runs in its own utilityProcess;
 * main sends it `ToHost` messages and routes its `ToMain` ones.
 */

export type HostEnv = {
  /** A Node to run the adapter with: Electron itself, run as Node. */
  node: string;
  nodeEnv: Record<string, string>;
  /** The ACP adapter's entry file. */
  adapter: string;
  adapterVersion: string;
  /** Finds the person's `claude`, with their shell's PATH; null when not installed. */
  locate: () => Promise<{ claude: string | null; version: string | null; path: string }>;
};

type Turn = { thread: string; turn: string };

type ConnectionState =
  | { kind: "idle" }
  | { kind: "connecting"; ready: Promise<boolean> }
  | { kind: "connected"; conn: acp.ClientConnection; child: ChildProcess; versions: AgentVersions }
  | { kind: "failed"; reason: string };

export class AgentHost {
  private state: ConnectionState = { kind: "idle" };
  /** Each thread's live session. */
  private readonly sessions = new Map<string, string>();
  /** The turn running in each session, so updates reach the right thread. */
  private readonly running = new Map<string, Turn>();
  private readonly permissions = new Map<string, (option: string | null) => void>();

  constructor(
    private readonly send: (m: ToMain) => void,
    private readonly env: HostEnv,
  ) {}

  handle(m: ToHost): void {
    switch (m.type) {
      case "connect":
        void this.connect();
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
        return;
    }
  }

  /** Start the adapter once; later calls wait for the same start. */
  connect(): Promise<boolean> {
    if (this.state.kind === "connected") return Promise.resolve(true);
    if (this.state.kind === "connecting") return this.state.ready;
    const ready = this.start().then(
      (ok) => ok,
      (e: unknown) =>
        this.fail(`The agent didn't start: ${e instanceof Error ? e.message : String(e)}`),
    );
    this.state = { kind: "connecting", ready };
    return ready;
  }

  private fail(reason: string): false {
    this.state = { kind: "failed", reason };
    this.send({ type: "status", connected: false, reason, agent: null });
    return false;
  }

  private async start(): Promise<boolean> {
    const found = await this.env.locate();
    if (!found.claude)
      return this.fail(
        "Claude Code isn't installed. Install it, sign in once in a terminal, then try again.",
      );
    const child = spawn(this.env.node, [this.env.adapter], {
      env: {
        ...process.env,
        ...this.env.nodeEnv,
        PATH: found.path,
        // The person's own install, not the one bundled in the adapter's SDK.
        CLAUDE_CODE_EXECUTABLE: found.claude,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-4000);
    });
    child.on("exit", (code) => {
      if (this.state.kind === "connected" && this.state.child === child) {
        for (const [, t] of this.running)
          this.send({
            type: "error",
            thread: t.thread,
            turn: t.turn,
            message: "The agent stopped.",
          });
        this.running.clear();
        this.sessions.clear();
        this.fail(
          `The agent stopped (exit ${String(code)}). ${stderr.trim().split("\n").at(-1) ?? ""}`,
        );
      }
    });
    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>,
    );
    const app = acp
      .client({ name: "anur" })
      .onNotification(acp.methods.client.session.update, ({ params }) => {
        this.onUpdate(params);
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
      agent: found.version ?? init.agentInfo?.version ?? "unknown",
      adapter: this.env.adapterVersion,
    };
    this.state = { kind: "connected", conn, child, versions };
    this.send({ type: "status", connected: true, reason: null, agent: versions });
    return true;
  }

  private async session(conn: acp.ClientConnection, spec: SessionSpec): Promise<string> {
    const live = this.sessions.get(spec.thread);
    if (live) return live;
    const meta = { claudeCode: { options: { settings: spec.settings } } };
    if (spec.resume) {
      try {
        await conn.agent.request(acp.methods.agent.session.load, {
          sessionId: spec.resume,
          cwd: spec.cwd,
          mcpServers: [],
          _meta: meta,
        });
        this.sessions.set(spec.thread, spec.resume);
        this.send({ type: "session", thread: spec.thread, session: spec.resume, event: "resumed" });
        return spec.resume;
      } catch {
        throw new ResumeFailed();
      }
    }
    const created = await conn.agent.request(acp.methods.agent.session.new, {
      cwd: spec.cwd,
      mcpServers: [],
      _meta: meta,
    });
    this.sessions.set(spec.thread, created.sessionId);
    this.send({
      type: "session",
      thread: spec.thread,
      session: created.sessionId,
      event: "started",
    });
    return created.sessionId;
  }

  private async prompt(spec: SessionSpec, turn: string, text: string): Promise<void> {
    const fail = (message: string) => {
      this.send({ type: "error", thread: spec.thread, turn, message });
    };
    if (!(await this.connect()) || this.state.kind !== "connected") {
      fail(this.state.kind === "failed" ? this.state.reason : "The agent isn't connected.");
      return;
    }
    const { conn } = this.state;
    let sessionId: string;
    try {
      sessionId = await this.session(conn, spec);
    } catch (e) {
      if (e instanceof ResumeFailed) fail("resume-failed");
      else fail(`The agent couldn't start this thread: ${messageOf(e)}`);
      return;
    }
    this.running.set(sessionId, { thread: spec.thread, turn });
    try {
      const res = await conn.agent.request(acp.methods.agent.session.prompt, {
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
    const sessionId = this.sessions.get(thread);
    if (!sessionId || this.state.kind !== "connected") return;
    for (const [id, resolve] of this.permissions) {
      if (id.startsWith(`${thread}:`)) {
        resolve(null);
        this.permissions.delete(id);
      }
    }
    await this.state.conn.agent.notify(acp.methods.agent.session.cancel, { sessionId });
  }

  private onUpdate(params: acp.SessionNotification): void {
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
    }
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

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
