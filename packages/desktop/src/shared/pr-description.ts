import { noteOf } from "./release-notes.ts";

/**
 * What a PR description must hold, from .github/pull_request_template.md:
 * `gh pr create --body` skips the template, so CI checks the body instead.
 */
const SECTIONS = ["What changes, and why", "Release note", "How it was checked"] as const;

/** A section's text without the template's <!-- hints -->, or null when the heading is missing. */
function sectionOf(body: string, name: string): string | null {
  const m = new RegExp(
    `^##\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$([\\s\\S]*?)(?=^##\\s|$(?![\\s\\S]))`,
    "im",
  ).exec(body);
  return m ? (m[1] ?? "").replace(/<!--[\s\S]*?-->/g, "").trim() : null;
}

/** What's wrong with a PR description, as one line each to fix; empty when it's fine. */
export function prDescriptionProblems(body: string): string[] {
  const problems: string[] = [];
  for (const name of SECTIONS)
    if (sectionOf(body, name) === null)
      problems.push(`Add the "## ${name}" section from .github/pull_request_template.md.`);
  if (sectionOf(body, "What changes, and why") === "")
    problems.push(`Say under "## What changes, and why" what someone using Anur notices.`);
  if (sectionOf(body, "Release note") !== null && noteOf(body) === null)
    problems.push(`Write one line under "## Release note" for What's new, or "none".`);
  return problems;
}
