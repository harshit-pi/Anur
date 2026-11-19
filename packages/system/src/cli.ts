#!/usr/bin/env node
/**
 * anur-system: the headless scanner (group 20.7), for the pre-commit hook,
 * CI and anyone at a terminal. No Electron.
 *
 *   anur-system scan <folder> [--json] [--pin] [--known <file>]
 *   anur-system hook [--folder <folder>]   (Claude Code's UserPromptSubmit and Stop, on stdin)
 *   anur-system claude-md <repo> [--staged | --stage]  (the CLAUDE.md block, 23.5; --stage writes it into the commit, 23.6)
 *   anur-system hooks <folder>  (JSON: each repo whose hook isn't rebuilding its CLAUDE.md block, and why, 23.8)
 *   anur-system edge-sides <folder>  (each repo's CLAUDE.local.md lists decisions on its calls kept at the other end, 23.10)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { stageClaudeMd, writeClaudeMd } from "./claude-md.ts";
import { writeEdgeSides } from "./claude-local.ts";
import { hookTrouble } from "./pre-commit.ts";
import path from "node:path";
import { handleHook, type HookInput } from "./hook.ts";
import { scanSystem } from "./system.ts";
import type { KnownPart } from "./parts.ts";

const args = process.argv.slice(2);
const [cmd, folder] = args;
if (cmd === "hook") {
  // A hook never fails the agent: exit 0 whatever happens.
  try {
    const input = JSON.parse(readFileSync(0, "utf8") || "{}") as HookInput;
    const at = args.indexOf("--folder");
    const result = await handleHook(input, at >= 0 ? args[at + 1] : undefined);
    if (result.kind === "reported") process.stderr.write(`anur: task report ${result.file}\n`);
    // Claude Code reads this from stdout and adds it to the prompt's context.
    if (result.kind === "marked")
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "UserPromptSubmit",
            additionalContext: result.context,
          },
        }),
      );
  } catch (e) {
    process.stderr.write(`anur: ${e instanceof Error ? e.message : String(e)}\n`);
  }
  process.exit(0);
}
if (cmd === "claude-md") {
  const repo = folder ?? process.cwd();
  // --stage: the pre-commit hook's step, writing the block into the commit itself (23.6).
  const changed = args.includes("--stage")
    ? stageClaudeMd(repo)
    : writeClaudeMd(repo, { staged: args.includes("--staged") });
  process.stdout.write(changed ? "anur: CLAUDE.md block updated\n" : "");
  process.exit(0);
}
if (cmd === "hooks" && folder) {
  const scan = scanSystem(folder);
  const out = scan.repos.flatMap((r) => {
    const trouble = hookTrouble(path.join(folder, r.dir));
    return trouble ? [{ repo: r.dir, ...trouble }] : [];
  });
  process.stdout.write(`${JSON.stringify(out)}\n`);
  process.exit(0);
}
if (cmd === "edge-sides" && folder) {
  const written = writeEdgeSides(folder);
  if (written.length)
    process.stdout.write(`anur: CLAUDE.local.md updated in ${written.join(", ")}\n`);
  process.exit(0);
}
if (cmd !== "scan" || !folder) {
  process.stderr.write(
    "Usage: anur-system scan <folder> [--json] [--pin] [--known <file>]\n       anur-system hook [--folder <folder>]\n       anur-system claude-md <repo> [--staged | --stage]\n       anur-system hooks <folder>\n       anur-system edge-sides <folder>\n",
  );
  process.exit(2);
}
const knownAt = args.indexOf("--known");
const knownFile = knownAt >= 0 ? args[knownAt + 1] : undefined;
let known: KnownPart[] = [];
if (knownFile) {
  try {
    known = JSON.parse(readFileSync(knownFile, "utf8")) as KnownPart[];
  } catch {
    known = [];
  }
}
const scan = scanSystem(folder, { pin: args.includes("--pin"), known });
if (knownFile) writeFileSync(knownFile, `${JSON.stringify(scan.known, null, 1)}\n`);
if (args.includes("--json")) {
  process.stdout.write(`${JSON.stringify(scan, null, 1)}\n`);
} else {
  for (const r of scan.repos) {
    process.stdout.write(`${r.dir}${r.github ? `  (${r.github})` : ""}\n`);
    for (const p of scan.parts.filter((x) => x.repo === r.dir))
      process.stdout.write(`  ${p.kind.padEnd(8)}${p.name}  ${p.file}\n`);
  }
  for (const p of scan.problems) process.stdout.write(`! ${p.where}: ${p.what}\n`);
}
