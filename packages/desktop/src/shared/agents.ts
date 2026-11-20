/**
 * The agents a thread can run on. A thread belongs to Anur, not to its
 * agent: its section, bundle and every message are kept in `.anur/`, so any
 * agent can take a thread over, rebuilt from its bundle and chat.
 *
 * An agent runs threads only once it passes its own thread check (Context,
 * "Which agents can run threads"): Codex and Gemini CLI wait until their
 * ACP adapters offer deny rules and a hook before tool calls.
 */

export const AGENT_IDS = ["claude-code", "kiro", "codex", "gemini-cli"] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export const DEFAULT_AGENT: AgentId = "claude-code";

export const AGENTS: Record<AgentId, { name: string; runsThreads: boolean; why: string | null }> = {
  "claude-code": { name: "Claude Code", runsThreads: true, why: null },
  kiro: { name: "Kiro", runsThreads: true, why: null },
  codex: {
    name: "Codex",
    runsThreads: false,
    why: "Not yet: its adapter has no hook before tool calls, so Anur can't keep other threads out.",
  },
  "gemini-cli": {
    name: "Gemini CLI",
    runsThreads: false,
    why: "Not yet: its adapter has no hook before tool calls, so Anur can't keep other threads out.",
  },
};

export const isAgentId = (v: unknown): v is AgentId =>
  typeof v === "string" && (AGENT_IDS as readonly string[]).includes(v);

/**
 * The preview that holds a person's own unsaved typing that clashed with a
 * change made outside Anur (3.10): it sits among threads' previews, under
 * this name, with no thread behind it.
 */
export const UNSAVED_EDIT = "unsaved";
/** The preview an agent in a terminal proposed through `anur_propose_preview` (6.6). */
export const TERMINAL_EDIT = "terminal";
