import { z } from "zod";
import { LineEnvelope, mergeLines, parseJsonl } from "../jsonl/lines.ts";

/**
 * Decisions committed with the code (23.2; Design - Engineering Plugin §6).
 * Each person appends to their own file in the repo,
 * `.anur/decisions/<person>.jsonl`, so no file ever has two writers and no
 * PR conflicts on it. A decision is the team's once it's on the default
 * branch. Nobody edits another person's file: dropping or replacing anyone's
 * decision, a leaver's too, is a "dropped" line in your own file naming it.
 *
 * Findings a person kept travel the same way, as their own kind;
 * unreviewed ones stay in the thread.
 */

export const DECISIONS_DIR = "decisions";

const Common = LineEnvelope.extend({
  /**
   * What it's about: a part or edge ID once the system knows it (23.1), or
   * a doc's section ("section:<doc>#<A › B>"), or "repo" for the whole repo.
   */
  scope: z.string().min(1).max(600),
  /** The thread finding it came from, so Undo there finds it here. */
  ref: z.string().max(64).nullable(),
  /** A part's or line's name as the map shows it, for a "part:" or "edge:" scope (23.1). */
  on: z.string().max(300).nullable().optional(),
  /**
   * The folder a part covers, from where the file lives ("" for all of it),
   * so work on docs inside it carries the decision; absent for a line, or a
   * part in another repo.
   */
  within: z.string().max(600).nullable().optional(),
});

/** A decision a person stands behind, in their exact words. */
export const CommittedDecision = Common.extend({
  kind: z.literal("decision"),
  /** The decision in under 15 words. */
  decision: z.string().min(1).max(400),
  quote: z.string().max(600).nullable(),
  instead: z.string().max(300).nullable(),
  until: z.string().max(200).nullable(),
  /** Who made it, by name, as people know them; the file name says whose file it is. */
  who: z.string().max(200).nullable(),
});

/** A finding a person kept: a claim, with where it came from. */
export const CommittedFinding = Common.extend({
  kind: z.literal("finding"),
  claim: z.string().min(1).max(600),
  source: z.string().max(600).nullable(),
});

/** Takes back a decision or finding, anyone's, by its ID. */
export const CommittedDropped = LineEnvelope.extend({
  kind: z.literal("dropped"),
  target: z.string().min(8).max(64),
});

export const CommittedLine = z.discriminatedUnion("kind", [
  CommittedDecision,
  CommittedFinding,
  CommittedDropped,
]);
export type CommittedLine = z.infer<typeof CommittedLine>;
export type CommittedEntry = Extract<CommittedLine, { kind: "decision" | "finding" }> & {
  /** The file it's in: whose it is. */
  person: string;
};

/** The current decisions and findings in a repo: every person's file, less what anyone dropped. */
export function currentEntries(
  files: readonly { person: string; text: string }[],
): CommittedEntry[] {
  const owner = new Map<string, string>();
  const parsed = files.map((f) => {
    const lines = parseJsonl(f.text, CommittedLine).lines;
    for (const l of lines) if (!owner.has(l.id)) owner.set(l.id, f.person);
    return lines;
  });
  const all = mergeLines(...parsed);
  const dropped = new Set(all.flatMap((l) => (l.kind === "dropped" ? [l.target] : [])));
  return all.flatMap((l) =>
    l.kind === "dropped" || dropped.has(l.id) ? [] : [{ ...l, person: owner.get(l.id) ?? "" }],
  );
}

/** A GitHub login from a noreply commit email: "123+sam@users.noreply.github.com". */
export function loginFromEmail(email: string): string | null {
  const m = /^(?:\d+\+)?([A-Za-z0-9-]+)@users\.noreply\.github\.com$/i.exec(email.trim());
  return m?.[1] ?? null;
}

/**
 * Whose file: the GitHub login when known, else a short hash of the git
 * email, so no email ever appears in a path.
 */
export function personKey(
  id: { login: string | null; email: string | null },
  /** SHA-256 as hex; the core runs anywhere, so the caller brings it. */
  sha256: (text: string) => string,
): string | null {
  const login = id.login?.trim().toLowerCase();
  if (login && /^[a-z0-9][a-z0-9-]{0,38}$/.test(login)) return login;
  const email = id.email?.trim().toLowerCase();
  if (!email) return null;
  return `e-${sha256(email).slice(0, 12)}`;
}

/** Always committed: decisions, and the home's ID that keeps doc IDs the same on every clone. */
const KEEP_DECISIONS = ["!.gitignore", "!decisions/", "!decisions/*.jsonl", "!home-id"];

/**
 * `.anur/.gitignore` with decisions committed. A folder commits `.anur/` by
 * default (no file: nothing to change); one that keeps it out of git with
 * "*" still commits its decisions. Null when the file needs no change.
 */
export function gitignoreKeepingDecisions(current: string | null): string | null {
  if (current === null) return null;
  const rows = current.split("\n").map((r) => r.trim());
  if (KEEP_DECISIONS.every((k) => rows.includes(k))) return null;
  const body = current.endsWith("\n") || current === "" ? current : `${current}\n`;
  return body + KEEP_DECISIONS.filter((k) => !rows.includes(k)).join("\n") + "\n";
}

/**
 * A section scope, "section:<doc>#<A › B>", read from the home it was kept
 * in, as the doc's path from the opened folder and the heading path; null
 * for a scope that isn't a section's, such as a part's (23.1).
 */
export function sectionScope(scope: string, home: string): { doc: string; path: string[] } | null {
  const m = /^section:([^#]+)#(.*)$/s.exec(scope);
  if (!m?.[1]) return null;
  const parts = [...(home && home !== "." ? home.split("/") : []), ...m[1].split("/")];
  const doc: string[] = [];
  for (const p of parts)
    if (p === "..") doc.pop();
    else if (p && p !== ".") doc.push(p);
  return { doc: doc.join("/"), path: m[2] ? m[2].split(" › ") : [] };
}
