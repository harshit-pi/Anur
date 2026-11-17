import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { decide, type HookConfig } from "./hook-rules.ts";

/**
 * Anur's hook program. Claude Code runs it for SessionStart and before every
 * tool call, with the call as JSON on stdin, as a command hook in the
 * session's settings: the only kind that crosses ACP (spike, 2026-11-17).
 *
 * It logs every call, so the agent host can check that each completed tool
 * call passed through it (3.2), and refuses what `hook-rules.ts` refuses.
 * When it sends the agent to a doc's working copy, it makes that copy first,
 * from the doc as it is on disk (3.6).
 */

type HookInput = {
  hook_event_name?: string;
  session_id?: string;
  source?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_use_id?: string;
  cwd?: string;
};

function resolveReal(p: string, cwd: string): string {
  const abs = path.resolve(cwd, p);
  try {
    return realpathSync(abs);
  } catch {
    try {
      return path.join(realpathSync(path.dirname(abs)), path.basename(abs));
    } catch {
      return abs;
    }
  }
}

function main(): void {
  const configPath = process.argv[2];
  if (!configPath) return;
  const config = JSON.parse(readFileSync(configPath, "utf8")) as HookConfig;
  const input = JSON.parse(readFileSync(0, "utf8")) as HookInput;
  const log = (entry: Record<string, unknown>) => {
    appendFileSync(
      config.log,
      `${JSON.stringify({ at: new Date().toISOString(), session: input.session_id ?? null, ...entry })}\n`,
    );
  };

  if (input.hook_event_name === "SessionStart") {
    log({ event: "start", source: input.source ?? null });
    return;
  }
  if (input.hook_event_name !== "PreToolUse" || !input.tool_name) return;

  const decision = decide(
    {
      tool_name: input.tool_name,
      tool_input: input.tool_input ?? {},
      cwd: input.cwd ?? config.folder,
    },
    config,
    resolveReal,
  );
  log({
    event: "tool",
    toolUse: input.tool_use_id ?? null,
    tool: input.tool_name,
    refused: decision?.reason ?? null,
  });
  if (decision?.copy && !existsSync(decision.copy.to)) {
    mkdirSync(path.dirname(decision.copy.to), { recursive: true });
    copyFileSync(decision.copy.from, decision.copy.to);
  }
  if (decision) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: decision.reason,
        },
      }),
    );
  }
}

try {
  main();
} catch (e) {
  // A hook that can't decide refuses: the session's settings mark it onFailure "block".
  process.stderr.write(`Anur's hook failed: ${String(e)}\n`);
  process.exit(2);
}
