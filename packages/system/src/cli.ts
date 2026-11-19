#!/usr/bin/env node
/**
 * anur-system: the headless scanner (group 20.7), for the pre-commit hook,
 * CI and anyone at a terminal. No Electron.
 *
 *   anur-system scan <folder> [--json] [--pin] [--known <file>]
 *   anur-system hook [--folder <folder>]   (Claude Code's UserPromptSubmit and Stop, on stdin)
 */
import { readFileSync, writeFileSync } from "node:fs";
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
if (cmd !== "scan" || !folder) {
  process.stderr.write(
    "Usage: anur-system scan <folder> [--json] [--pin] [--known <file>]\n       anur-system hook [--folder <folder>]\n",
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
