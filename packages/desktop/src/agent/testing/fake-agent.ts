import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

/**
 * A stand-in for Claude Code's ACP adapter, for the end-to-end test of the
 * main loop. It speaks enough ACP for one thread, and behaves as Claude Code
 * does where Anur depends on it: it runs the session's start hook, runs the
 * PreToolUse hook before its one tool call and honours a refusal, edits the
 * working copy the bundle names, and reports the call with its tool-use ID.
 *
 * FAKE_EDIT_FROM and FAKE_EDIT_TO say which line to change; FAKE_TARGET, if
 * set, is the file it tries to edit instead of the working copy.
 */

type Hook = { command: string; args?: string[] };
type Rpc = { id?: number; method?: string; params?: Record<string, unknown> };

const from = process.env.FAKE_EDIT_FROM ?? "";
const to = process.env.FAKE_EDIT_TO ?? "";
const sessions = new Map<string, { start: Hook[]; pre: Hook[] }>();
let n = 0;

const write = (m: object) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
const notify = (sessionId: string, update: object) => {
  write({ method: "session/update", params: { sessionId, update } });
};

/** Run a command hook as Claude Code does: the event as JSON on stdin; a deny on stdout refuses. */
function runHook(hook: Hook, input: object): string | null {
  const r = spawnSync(hook.command, hook.args ?? [], {
    input: JSON.stringify(input),
    encoding: "utf8",
  });
  if (r.status === 2) return "the hook failed";
  try {
    const out = JSON.parse(r.stdout || "{}") as {
      hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
    };
    return out.hookSpecificOutput?.permissionDecision === "deny"
      ? (out.hookSpecificOutput.permissionDecisionReason ?? "denied")
      : null;
  } catch {
    return null;
  }
}

function hooksOf(params: Record<string, unknown>) {
  const meta = params._meta as
    | { claudeCode?: { options?: { settings?: { hooks?: Record<string, { hooks: Hook[] }[]> } } } }
    | undefined;
  const hooks = meta?.claudeCode?.options?.settings?.hooks ?? {};
  return {
    start: (hooks.SessionStart ?? []).flatMap((h) => h.hooks),
    pre: (hooks.PreToolUse ?? []).flatMap((h) => h.hooks),
  };
}

function handle(m: Rpc): void {
  const p = m.params ?? {};
  switch (m.method) {
    case "initialize":
      write({
        id: m.id,
        result: {
          protocolVersion: 1,
          agentCapabilities: { loadSession: false },
          agentInfo: { name: "fake-agent", version: "0.0.0" },
          authMethods: [],
        },
      });
      return;
    case "session/new": {
      const sessionId = `fake-${String(++n)}`;
      const h = hooksOf(p);
      sessions.set(sessionId, h);
      for (const hook of h.start)
        runHook(hook, {
          hook_event_name: "SessionStart",
          session_id: sessionId,
          source: "startup",
        });
      write({ id: m.id, result: { sessionId } });
      return;
    }
    case "session/prompt": {
      const sessionId = String(p.sessionId);
      const s = sessions.get(sessionId);
      const prompt = ((p.prompt as { text?: string }[] | undefined) ?? [])
        .map((c) => c.text ?? "")
        .join("\n");
      // FAKE_TARGET aims the edit elsewhere, as an agent that ignores the bundle might.
      const copy = process.env.FAKE_TARGET ?? /is at `([^`]+)`/.exec(prompt)?.[1];
      let said = "I had nothing to edit.";
      if (s && copy) {
        const toolUse = `toolu_fake_${String(++n)}`;
        const refused = s.pre
          .map((hook) =>
            runHook(hook, {
              hook_event_name: "PreToolUse",
              session_id: sessionId,
              tool_name: "Edit",
              tool_input: { file_path: copy },
              tool_use_id: toolUse,
            }),
          )
          .find((r) => r !== null);
        notify(sessionId, {
          sessionUpdate: "tool_call",
          toolCallId: toolUse,
          title: `Edit ${copy}`,
          kind: "edit",
          status: "pending",
        });
        if (refused) {
          notify(sessionId, {
            sessionUpdate: "tool_call_update",
            toolCallId: toolUse,
            status: "failed",
          });
          said = `Refused: ${refused}`;
        } else {
          writeFileSync(copy, readFileSync(copy, "utf8").replace(from, to));
          notify(sessionId, {
            sessionUpdate: "tool_call_update",
            toolCallId: toolUse,
            status: "completed",
          });
          said = "Done.";
        }
      }
      notify(sessionId, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: said },
      });
      write({ id: m.id, result: { stopReason: "end_turn" } });
      return;
    }
    default:
      if (m.id !== undefined) write({ id: m.id, result: {} });
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  if (line.trim()) handle(JSON.parse(line) as Rpc);
});
