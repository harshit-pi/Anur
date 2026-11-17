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
  | { type: "error"; thread: string; turn: string | null; message: string };

export type ToHost =
  | { type: "connect"; agent: AgentId }
  | { type: "probe"; agent: AgentId; cwd: string }
  | { type: "prompt"; spec: SessionSpec; turn: string; text: string }
  | { type: "cancel"; thread: string }
  | { type: "permission"; request: string; option: string | null }
  | { type: "option"; thread: string; id: string; value: string }
  | { type: "close"; thread: string };

export type AgentVersions = { agent: string; adapter: string };
