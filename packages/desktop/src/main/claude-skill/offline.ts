import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import type { ToolAnswer } from "../threads/anur-socket.ts";
import { CommittedDecisions } from "../committed-decisions.ts";
import { personName } from "../folder/people.ts";
import { loadDeviceId } from "../../device/device-id.ts";
import { terminalHandler, type TerminalDeps } from "./terminal.ts";

const run = promisify(execFile);

/** The repo a folder is in, or the folder itself outside one. */
async function repoOf(cwd: string): Promise<string> {
  try {
    const { stdout } = await run("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
      timeout: 5000,
    });
    return stdout.trim() || cwd;
  } catch {
    return cwd;
  }
}

/**
 * A decision from a Claude Code session while Anur is closed (2026-11-19):
 * recorded straight into the session's repo, through the same checks as
 * with Anur open (the person's typed words, at most 7 words, a scope no
 * wider than said), and with this Mac's device ID, so Anur shows it, as its
 * own, when it next opens. A doc can't be named: only Anur knows its folder.
 */
export async function offlineDecision(
  tool: string,
  args: Record<string, unknown>,
  at: { cwd: string; appSupport: string },
  deps: Partial<TerminalDeps> = {},
): Promise<ToolAnswer> {
  if (typeof args.doc === "string" && args.doc.trim())
    return {
      error:
        "Anur is closed, so a doc can't be named. Leave out doc to record it for this repo, or ask the person to open Anur.",
    };
  // As git names it, through any symlink, so the session is found inside its repo.
  const cwd = await realpath(at.cwd).catch(() => at.cwd);
  const root = await repoOf(cwd);
  const device = await loadDeviceId(at.appSupport).catch(() => "terminal");
  const handler = terminalHandler({
    front: () => ({ folder: root, docs: [], webContentsId: 0 }),
    committed: (base: string) => new CommittedDecisions(base, device),
    me: () => personName(root, null),
    ...deps,
  } as TerminalDeps);
  const r = await handler(tool, { ...args, _cwd: cwd });
  return "text" in r
    ? { text: `${r.text} Anur is closed; it shows there when the person opens it.` }
    : r;
}
