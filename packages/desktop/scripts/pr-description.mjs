#!/usr/bin/env node
/**
 * CI: a PR's description holds the template's sections and a release note
 * (docs/patterns.md). Reads it from PR_BODY; each problem is a GitHub error.
 */
import { prDescriptionProblems } from "../src/shared/pr-description.ts";

const problems = prDescriptionProblems(process.env.PR_BODY ?? "");
for (const p of problems) console.log(`::error title=PR description::${p}`);
if (problems.length) {
  console.log("\nFix the PR's description, then re-run this check.");
  process.exit(1);
}
console.log("The PR description has every section and a release note.");
