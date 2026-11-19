/**
 * Release notes, gathered from the PRs a release holds: each PR's
 * "## Release note" section is one line for people using Anur, or "none".
 * Written to the GitHub release, the update feed and the app's What's new.
 */

export type PrNote = { number: number; title: string; body: string };

/** A PR's note: its line, "none" for nothing to tell, or null when it has none written. */
export function noteOf(body: string): string | null {
  const m = /^##\s+Release note\s*$([\s\S]*?)(?=^##\s|$(?![\s\S]))/im.exec(body);
  if (!m) return null;
  const text = (m[1] ?? "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!text) return null;
  return /^none\.?$/i.test(text) ? "none" : text;
}

/** The release's notes, and the PRs that still need one written. */
export function gather(prs: readonly PrNote[]): {
  notes: string[];
  missing: { number: number; title: string }[];
} {
  const notes: string[] = [];
  const missing: { number: number; title: string }[] = [];
  for (const pr of prs) {
    const n = noteOf(pr.body);
    if (n === null) missing.push({ number: pr.number, title: pr.title });
    else if (n !== "none") notes.push(`${n.replace(/\.$/, "")}.`);
  }
  return { notes, missing };
}

/** Notes as the update feed carries them: a YAML block, one "- " line each. */
export function feedBlock(notes: readonly string[]): string {
  if (notes.length === 0) return "";
  return `releaseNotes: |-\n${notes.map((n) => `  - ${n}`).join("\n")}\n`;
}

/** The feed's notes back as lines, however electron-updater hands them over. */
export function notesFrom(raw: unknown): string[] {
  const text = Array.isArray(raw)
    ? raw.map((r) => (r as { note?: string }).note ?? "").join("\n")
    : typeof raw === "string"
      ? raw
      : "";
  return text
    .replace(/<[^>]+>/g, "\n")
    .split("\n")
    .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
    .filter(Boolean)
    .slice(0, 12);
}
