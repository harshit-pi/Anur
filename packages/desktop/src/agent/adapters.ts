import { THREAD_SESSION_ENV } from "@anur/system";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
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
  /** The hook's config for this thread, which `hook` names as its last argument. */
  config: string;
  /** `.anur/`, closed to the agent's own file tools. */
  anurDir: string;
  /** Every home's `.anur/`, closed the same way (18.15.2). */
  anurDirs?: string[];
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
  /** The hook's form: Claude Code's, or Kiro's (its tool names, one global hook, exit 2). */
  hookFlavor?: "claude" | "kiro";
  /** Extra `clientCapabilities._meta` for initialize, such as Kiro's switch for its hooks. */
  clientMeta?: Record<string, unknown>;
  /** Where the session's start hook checks in, when not the thread's own log. */
  startLog?: string;
  /** A step's title as Claude Code would write it, which Think's labels read. */
  toolTitle?(title: string, input: unknown): string;
  /** Tell the hook which thread a session is, once the agent has named the session. */
  bindSession?(sessionId: string, guard: Guard): Promise<void>;
}

/** Kiro CLI's minimum: hooks in ~/.kiro/hooks/ run in V3, from 3.0 (spike, 2026-11-19). */
export const KIRO_MIN = "3.0.0";

/** Whether version `a` is at least `b`, both x.y.z. */
export function atLeast(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

/**
 * Kiro, through its own ACP server (`kiro-cli acp`), run as the person's
 * install and sign-in. Its guard is one global hook Anur installs in
 * ~/.kiro/hooks/: it acts only in sessions carrying ANUR_KIRO, and finds
 * each session's thread from the file `bindSession` writes.
 */
export function kiro(opts: {
  /** Anur's folder for Kiro: session bindings and the start check-ins. */
  dir: string;
  locate: () => Promise<{ kiro: string | null; version: string | null; path: string }>;
  /** Whether Anur's hook is in Kiro's global hooks, pointing at this app. */
  hookInstalled: () => Promise<boolean>;
}): AgentAdapter {
  return {
    id: "kiro",
    name: "Kiro",
    adapterVersion: "built-in",
    hookFlavor: "kiro",
    // Kiro loads hooks over ACP only when the client asks for them (spike, 2026-11-19).
    clientMeta: { kiro: { hooks: { enabled: true, v2: true } } },
    startLog: path.join(opts.dir, "start.jsonl"),
    async launch() {
      const found = await opts.locate();
      if (!found.kiro)
        return {
          fail: "Kiro CLI isn't installed. Install it, sign in once with kiro-cli login, then try again.",
        };
      if (!found.version || !atLeast(found.version, KIRO_MIN))
        return { fail: `Kiro CLI ${KIRO_MIN} or later is needed. Run kiro-cli update.` };
      if (!(await opts.hookInstalled()))
        return { fail: "Anur's hook isn't in Kiro. Turn Kiro on in Settings → Agents." };
      await mkdir(path.join(opts.dir, "sessions"), { recursive: true });
      return {
        command: found.kiro,
        args: ["acp", "--agent-engine", "v3", "--auth-method", "cli"],
        env: { PATH: found.path, ANUR_KIRO: opts.dir, [THREAD_SESSION_ENV]: "1" },
        version: found.version,
      };
    },
    sessionMeta() {
      return {};
    },
    toolTitle: kiroToolTitle,
    async bindSession(sessionId, guard) {
      if (!/^[\w.-]+$/.test(sessionId)) throw new Error(`Kiro named a session oddly: ${sessionId}`);
      await writeFile(
        path.join(opts.dir, "sessions", `${sessionId}.json`),
        JSON.stringify({ config: guard.config }),
      );
    },
  };
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
          // A thread's session: the person's task hooks leave it out of their tasks.
          [THREAD_SESSION_ENV]: "1",
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
                deny: [...new Set([guard.anurDir, ...(guard.anurDirs ?? [])])].flatMap((d) =>
                  ["Read", "Edit", "Write"].map((t) => `${t}(/${d}/**)`),
                ),
                additionalDirectories: [guard.copies],
              },
            },
          },
        },
      };
    },
  };
}

/**
 * Kiro's step titles ("Read File", "Run Command") as Claude Code's ("Read
 * notes.md", the command itself), from the call's input. Its tool loading
 * and Anur's own tools read as Claude Code's, which Think leaves out of the steps.
 */
export function kiroToolTitle(title: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof i[k] === "string" ? i[k] : null);
  if (title.startsWith("@anur/")) return `mcp__anur__${title.slice("@anur/".length)}`;
  if (title === "Tool Load" || title === "Load Resource") return "ToolSearch";
  const file = str("path");
  if (title === "Read File" && file) return `Read ${file}`;
  if (title === "Write File" && file) return `Write ${file}`;
  if (title === "Replace in File" && file) return `Edit ${file}`;
  if (title === "Run Command" && str("command")) return str("command") ?? title;
  if (title === "Fetch URL" && str("url")) return `WebFetch ${str("url") ?? ""}`;
  return title;
}
