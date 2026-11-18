#!/usr/bin/env node
/**
 * anur-system: the headless scanner (group 20.7), for the pre-commit hook,
 * CI and anyone at a terminal. No Electron.
 *
 *   anur-system scan <folder> [--json] [--pin] [--known <file>]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { scanSystem } from "./system.ts";
import type { KnownPart } from "./parts.ts";

const args = process.argv.slice(2);
const [cmd, folder] = args;
if (cmd !== "scan" || !folder) {
  process.stderr.write("Usage: anur-system scan <folder> [--json] [--pin] [--known <file>]\n");
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
