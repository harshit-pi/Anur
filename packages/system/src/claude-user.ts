import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderBlock, withBlock, type CommittedEntry } from "@anur/core";

/**
 * Decisions a person kept for everywhere (18.3), in Claude Code's own user
 * `CLAUDE.md` (`~/.claude/CLAUDE.md`, or inside `CLAUDE_CONFIG_DIR`), which
 * every session reads in every folder: the same block markers, so the
 * person's own text there is never touched. Nothing is written when Claude
 * Code isn't set up on this Mac. Whether it changed.
 */
export function writeUserClaudeMd(
  entries: readonly CommittedEntry[],
  claudeDir: string = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude"),
): boolean {
  if (!existsSync(claudeDir)) return false;
  const file = path.join(claudeDir, "CLAUDE.md");
  let now: string | null;
  try {
    now = readFileSync(file, "utf8");
  } catch {
    now = null;
  }
  const next = withBlock(now, renderBlock(entries, "everywhere"));
  if (next === null || next === now) return false;
  writeFileSync(file, next);
  return true;
}
