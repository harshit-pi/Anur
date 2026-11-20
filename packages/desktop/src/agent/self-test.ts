import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The thread check's first part (task 3.2; Context, "Which agents can run
 * threads"): before threads run, the hook program itself is given sample
 * calls in a throwaway folder and must refuse, redirect and allow each as
 * it should. No model is involved, and nothing is asked of the person.
 */

type Sample = { name: string; call: Record<string, unknown>; refused: boolean | RegExp };

/** Why the hook failed its samples, or null when it passed. */
export function selfTest(
  node: string,
  nodeEnv: Record<string, string>,
  hook: string,
  /** Claude Code's hook form, or Kiro's: its tool names, one global hook, exit code 2 to refuse. */
  flavor: "claude" | "kiro" = "claude",
): string | null {
  // The real path: the hook resolves symlinks, as macOS's /var to /private/var.
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "anur-check-")));
  try {
    const folder = path.join(root, "Vault");
    const copies = path.join(root, "copies", "t1");
    mkdirSync(path.join(folder, ".anur", "docs"), { recursive: true });
    writeFileSync(path.join(folder, ".anur", "docs", "other.jsonl"), "secret\n");
    writeFileSync(path.join(folder, "plan.md"), "# Plan\n");
    const config = path.join(root, "hook.json");
    const log = path.join(root, "hook.log.jsonl");
    writeFileSync(
      config,
      JSON.stringify({
        folder,
        anurDir: path.join(folder, ".anur"),
        thread: "t1",
        log,
        copies,
        copiesRoot: path.join(root, "copies"),
      }),
    );
    const kiro = flavor === "kiro";
    const kiroDir = path.join(root, "kiro");
    if (kiro) {
      mkdirSync(path.join(kiroDir, "sessions"), { recursive: true });
      writeFileSync(path.join(kiroDir, "sessions", "check.json"), JSON.stringify({ config }));
    }
    const KIRO: Record<string, string> = {
      Read: "read_file",
      Edit: "str_replace",
      Write: "fs_write",
      Bash: "execute_bash",
    };
    const tool = (tool_name: string, tool_input: Record<string, unknown>) => {
      if (!kiro)
        return {
          hook_event_name: "PreToolUse",
          session_id: "check",
          tool_name,
          tool_input,
          tool_use_id: `check-${tool_name}`,
          cwd: folder,
        };
      const { file_path, ...rest } = tool_input;
      return {
        hook_event_name: "PreToolUse",
        session_id: "check",
        tool_name: KIRO[tool_name] ?? tool_name,
        tool_input: file_path === undefined ? rest : { ...rest, path: file_path },
        cwd: folder,
      };
    };
    const samples: Sample[] = [
      {
        name: "a read of another thread",
        call: tool("Read", { file_path: ".anur/docs/other.jsonl" }),
        refused: true,
      },
      {
        name: "a recursive search from the folder",
        call: tool("Bash", { command: "grep -rn secret ." }),
        refused: true,
      },
      { name: "git clean -x", call: tool("Bash", { command: "git clean -xfd" }), refused: true },
      { name: "a search with rg", call: tool("Bash", { command: "rg secret" }), refused: false },
      {
        name: "an edit of a doc",
        call: tool("Edit", { file_path: "plan.md" }),
        refused: new RegExp(
          `working copy of plan\\.md is at ${escape(path.join(copies, "plan.md"))}`,
        ),
      },
      {
        // Allowed, as in Obsidian: Anur turns it into the thread's proposal afterwards.
        name: "a shell write to a doc",
        call: tool("Bash", { command: "echo x >> plan.md" }),
        refused: false,
      },
    ];
    const runHook = (call: Record<string, unknown>, marked = true) =>
      spawnSync(node, kiro ? [hook, "--kiro"] : [hook, config], {
        input: JSON.stringify(call),
        env: {
          ...process.env,
          ...nodeEnv,
          ...(kiro && marked ? { ANUR_KIRO: kiroDir } : {}),
        },
        encoding: "utf8",
        timeout: 10_000,
      });
    if (kiro) {
      // The person's own Kiro sessions carry no marker, and pass untouched.
      const own = runHook(tool("Read", { file_path: ".anur/docs/other.jsonl" }), false);
      if (own.status !== 0) return "the hook refused a Kiro session that isn't Anur's";
      // A session Anur didn't start, such as a sub-agent's, is refused.
      const stray = runHook({ ...tool("Bash", { command: "ls" }), session_id: "unknown" });
      if (stray.status !== 2) return "the hook allowed a Kiro session Anur doesn't know";
    }
    for (const s of samples) {
      const run = runHook(s.call);
      if (kiro && run.status !== 0 && run.status !== 2)
        return `the hook didn't run (${run.stderr.trim() || String(run.status)})`;
      if (!kiro && run.status !== 0)
        return `the hook didn't run (${run.stderr.trim() || String(run.status)})`;
      const reason = (() => {
        if (kiro) return run.status === 2 ? run.stderr.trim() : null;
        try {
          const out = JSON.parse(run.stdout || "{}") as {
            hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
          };
          return out.hookSpecificOutput?.permissionDecision === "deny"
            ? (out.hookSpecificOutput.permissionDecisionReason ?? "")
            : null;
        } catch {
          return null;
        }
      })();
      const ok =
        s.refused === false
          ? reason === null
          : s.refused === true
            ? reason !== null
            : reason !== null && s.refused.test(reason);
      if (!ok) return `the hook ${reason === null ? "allowed" : "refused"} ${s.name}`;
    }
    // Every call is logged, for matching against what the agent reports.
    const logged = readFileSync(log, "utf8").trim().split("\n").length;
    if (logged !== samples.length) return "the hook didn't log every call";
    return null;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
