import type { AgentId } from "../shared/agents.ts";
import type { Guard } from "./adapters.ts";

/**
 * Messages between main and the agent host (Architecture, "Processes").
 * The host runs in its own utilityProcess, so a slow agent never freezes
 * the app; main only routes these to and from the thread's window.
 */

/** Everything the host needs to run one thread's session. */
export type SessionSpec = {
  thread: string;
  /** The agent the thread runs on now. */
  agent: AgentId;
  /** The agent's working folder: the opened folder. */
  cwd: string;
  /** Anur's guard, which the agent's adapter puts into that agent's own settings. */
  guard: Guard;
  /** The agent session to resume; null starts a new one. */
  resume: string | null;
  /** The hook's log for this thread, read for the thread check (3.2). */
  hookLog: string;
  /** Anur's MCP server for this session: the agent starts it, with its token (3.12). */
  mcp: { command: string; args: string[]; env: { name: string; value: string }[] } | null;
};

/** A choice the agent offers for its session, such as its mode or its model (3.5). */
export type SessionOption = {
  id: string;
  name: string;
  current: string;
  choices: { value: string; name: string; description: string | null }[];
};

export type ToMain =
  | {
      type: "status";
      id: AgentId;
      connected: boolean;
      reason: string | null;
      agent: AgentVersions | null;
    }
  | {
      type: "session";
      thread: string;
      session: string;
      agent: AgentId;
      event: "started" | "resumed";
    }
  | { type: "options"; thread: string; options: SessionOption[] }
  /** Whether the agent is signed in, and the sign-ins its adapter offers (3.16). */
  | { type: "auth"; agent: AgentId; auth: AgentAuth }
  /** A sign-in under way: the page to finish it on, once the agent prints it. */
  | {
      type: "sign-in";
      agent: AgentId;
      phase: "waiting" | "failed";
      url: string | null;
      message: string | null;
    }
  /** An agent's choices, read from a throwaway session: for a thread that has none yet. */
  | { type: "agent-options"; agent: AgentId; options: SessionOption[] }
  | { type: "text"; thread: string; turn: string; text: string }
  | {
      type: "tool";
      thread: string;
      turn: string;
      toolUse: string;
      title: string;
      kind: string | null;
      status: "pending" | "in_progress" | "completed" | "failed";
      input: unknown;
    }
  | {
      type: "permission";
      thread: string;
      request: string;
      title: string;
      options: { id: string; name: string; kind: string }[];
    }
  | {
      type: "turn-end";
      thread: string;
      turn: string;
      stopReason: string;
      usage: { input: number; output: number; cacheRead: number; cacheWrite: number } | null;
    }
  | { type: "error"; thread: string; turn: string | null; message: string }
  /** The session's context in use and its model's window, as the agent reports them (4.9). */
  | { type: "context"; thread: string; turn: string; used: number; size: number };

export type ToHost =
  | { type: "connect"; agent: AgentId }
  | { type: "probe"; agent: AgentId; cwd: string }
  | { type: "auth"; agent: AgentId }
  | { type: "sign-in"; agent: AgentId; method: string }
  | { type: "sign-in-cancel"; agent: AgentId }
  | { type: "prompt"; spec: SessionSpec; turn: string; text: string }
  | { type: "cancel"; thread: string }
  | { type: "permission"; request: string; option: string | null }
  | { type: "option"; thread: string; id: string; value: string }
  | { type: "close"; thread: string };

export type AgentVersions = { agent: string; adapter: string };

export type AgentAuth = {
  state: "authenticated" | "unauthenticated" | "unknown";
  /** Who is signed in, as the agent names it, such as an email or "Claude Max". */
  account: string | null;
  /** The sign-ins the agent's adapter offers, each run by Anur without a terminal. */
  methods: { id: string; name: string; description: string | null }[];
};
