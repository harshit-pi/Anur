import type { AgentId } from "../shared/agents.ts";

/**
 * Each agent Anur can drive, behind one interface. The host speaks ACP to
 * every agent the same way; an adapter says only how to start that agent's
 * ACP adapter and how to put Anur's guard (its hook and deny rules) into
 * that agent's own settings. Adding Codex or Gemini CLI is a new adapter
 * plus its own thread check, not a change to threads.
 */

/** What every thread's session must carry, whatever the agent. */
export type Guard = {
  /** The hook program, run before every tool call and at session start. */
  hook: { command: string; args: string[] };
  /** `.anur/`, closed to the agent's own file tools. */
  anurDir: string;
  /** This thread's working copies, part of the agent's workspace. */
  copies: string;
};

export type Launch = {
  command: string;
  args: string[];
  env: Record<string, string>;
  /** The agent's own version, for each turn's record. */
  version: string | null;
};

export interface AgentAdapter {
  id: AgentId;
  name: string;
  adapterVersion: string;
  /** How to start the agent's ACP adapter, or why it can't start. */
  launch(): Promise<Launch | { fail: string }>;
  /** The session's `_meta`: Anur's guard in the agent's own settings. */
  sessionMeta(guard: Guard): Record<string, unknown>;
}

/** Claude Code, through its ACP adapter, run as the person's own install. */
export function claudeCode(opts: {
  node: string;
  nodeEnv: Record<string, string>;
  adapter: string;
  adapterVersion: string;
  locate: () => Promise<{ claude: string | null; version: string | null; path: string }>;
}): AgentAdapter {
  return {
    id: "claude-code",
    name: "Claude Code",
    adapterVersion: opts.adapterVersion,
    async launch() {
      const found = await opts.locate();
      if (!found.claude)
        return {
          fail: "Claude Code isn't installed. Install it, sign in once in a terminal, then try again.",
        };
      return {
        command: opts.node,
        args: [opts.adapter],
        env: {
          ...opts.nodeEnv,
          PATH: found.path,
          // The person's own install, not the one bundled in the adapter's SDK.
          CLAUDE_CODE_EXECUTABLE: found.claude,
        },
        version: found.version,
      };
    },
    sessionMeta(guard) {
      // A command hook is the only kind that crosses ACP (spike, 2026-11-17).
      const hook = { type: "command", ...guard.hook, timeout: 10 };
      return {
        claudeCode: {
          options: {
            settings: {
              hooks: {
                SessionStart: [{ hooks: [hook] }],
                PreToolUse: [{ matcher: "*", hooks: [hook] }],
              },
              permissions: {
                // "//abs/path" is the absolute-path form of a permission rule.
                deny: ["Read", "Edit", "Write"].map((t) => `${t}(/${guard.anurDir}/**)`),
                additionalDirectories: [guard.copies],
              },
            },
          },
        },
      };
    },
  };
}
