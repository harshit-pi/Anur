import type { CommittedEntry } from "./committed.ts";
import { untilPassed } from "./until.ts";

/**
 * The block in a repo's `CLAUDE.md` that carries its committed decisions to
 * every agent, with or without Anur (23.5; Design - Engineering Plugin §7).
 * Built only from the repo's own `.anur/decisions/` files as committed, and
 * sorted by ID, so every Mac writes the same bytes: two people committing
 * never fight over it. Anur owns the block between its two markers; the rest
 * of the file is the person's and is never touched.
 */

export const BLOCK_BEGIN = "<!-- anur:decisions:begin -->";
export const BLOCK_END = "<!-- anur:decisions:end -->";
/** Its own block, beside the person's own, so each is rewritten without the other (23.10). */
export const EDGES_BEGIN = "<!-- anur:edges:begin -->";
export const EDGES_END = "<!-- anur:edges:end -->";

/** One line of text, so an entry can't break the list or the block. */
const flat = (s: string) => s.replace(/\s+/g, " ").replace(/-->/g, "-- >").trim();

/** Where a scope points, as a person reads it. */
function where(scope: string, on?: string | null): string | null {
  // A part or a line, by the name the map gives it (23.1).
  if (/^(part|edge):/.test(scope)) return on ?? null;
  const section = /^section:([^#]+)#(.*)$/s.exec(scope);
  if (section) return section[2] ? `${section[1] ?? ""} › ${section[2]}` : (section[1] ?? null);
  if (scope === "repo" || scope === "everywhere") return null;
  const folder = /^folder:(.+)$/.exec(scope);
  if (folder) return folder[1] ?? null;
  return scope;
}

/**
 * How the block opens: the team's, in `CLAUDE.md`, or one person's decisions
 * not yet on the default branch, in their own `CLAUDE.local.md` (23.9).
 */
export type BlockKind = "team" | "local" | "everywhere" | "edges";

const markers = (kind: BlockKind) =>
  kind === "edges" ? ([EDGES_BEGIN, EDGES_END] as const) : ([BLOCK_BEGIN, BLOCK_END] as const);

const HEADINGS: Record<BlockKind, { title: string; intro: string; facts?: string }> = {
  edges: {
    title: "## Decisions on calls with other repos",
    intro:
      "Kept in the repo at the other end of a call to or from this one, so this repo's `CLAUDE.md` doesn't list them. Follow them when your work touches that call: when it relies on one, say so in one line; if a task can't be done without going against one, don't: say which, and ask.",
    facts:
      "Facts people kept about these calls. Treat them as settled unless a source you read now says otherwise.",
  },
  team: {
    title: "## Decisions",
    intro:
      "People working on this repo decided these. Follow them. When your work relies on one, say so in one line. If a task can't be done without going against one, don't: say which, and ask. Never edit `.anur/decisions/` yourself; a person changes a decision.",
  },
  everywhere: {
    title: "## Decisions that apply everywhere",
    intro:
      "Decided in Anur for every project, not one repo. Follow them in any work: when your work relies on one, say so in one line; if a task can't be done without going against one, don't: say which, and ask. A person changes these in Anur.",
  },
  local: {
    title: "## Decisions not yet merged",
    intro:
      "Decided here and kept, but not yet on the default branch, so the team's `CLAUDE.md` doesn't list them yet. Follow them as you would the team's: when your work relies on one, say so in one line; if a task can't be done without going against one, don't: say which, and ask. Never edit `.anur/decisions/` yourself; a person changes a decision.",
  },
};

/** The block for these entries, or null when there are none. */
export function renderBlock(
  entries: readonly CommittedEntry[],
  kind: BlockKind = "team",
  /** Today, for an "until" that has passed (23.3); the same all day on every Mac. */
  now: Date = new Date(),
): string | null {
  const sorted = [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const all = sorted.flatMap((e) => (e.kind === "decision" ? [e] : []));
  // Past its "until": listed apart, no longer followed (18.2, 23.3).
  const lapsed = all.filter((d) => untilPassed(d.until, d.at, now));
  const decisions = all.filter((d) => !lapsed.includes(d));
  // Pairs that disagree (18.4): by ID, or the thread finding a copy came from.
  const byId = new Map<string, (typeof all)[number]>();
  for (const d of decisions) {
    byId.set(d.id, d);
    if (d.ref) byId.set(d.ref, d);
  }
  const against = new Map<string, (typeof all)[number]>();
  for (const d of decisions) {
    const other = d.against ? byId.get(d.against) : undefined;
    if (!other || other === d) continue;
    against.set(d.id, other);
    against.set(other.id, d);
  }
  const findings = sorted.flatMap((e) => (e.kind === "finding" ? [e] : []));
  if (!all.length && !findings.length) return null;
  // Shaped as Prettier formats Markdown, so a repo that runs Prettier on
  // commit leaves it as written and every Mac's bytes stay the same.
  const [begin, end] = markers(kind);
  const lines = [
    begin,
    "",
    HEADINGS[kind].title,
    "",
    `Made by Anur from ${kind === "edges" ? "the other repos' " : ""}\`.anur/decisions/\`; edits between these markers are replaced.`,
    "",
  ];
  if (decisions.length) {
    lines.push(HEADINGS[kind].intro, "");
    for (const d of decisions) {
      const on = where(d.scope, d.on);
      const other = against.get(d.id);
      const tail = [
        d.instead ? `Instead of: ${flat(d.instead)}.` : null,
        d.until ? `Until: ${flat(d.until)}.` : null,
        other
          ? `Disagrees with "${flat(other.decision)}"${other.who ? ` (${flat(other.who)})` : ""}: neither holds until a person picks, so ask which holds.`
          : null,
      ].filter(Boolean);
      const meta = [d.who ? flat(d.who) : null, on ? `on ${flat(on)}` : null].filter(Boolean);
      // A sentence of its own, so "Instead of" never runs on from it.
      const said = flat(d.decision);
      const head = tail.length && !/[.!?]$/.test(said) ? `${said}.` : said;
      lines.push(
        `- ${head}${tail.length ? ` ${tail.join(" ")}` : ""}${meta.length ? ` (${meta.join(", ")})` : ""}`,
      );
    }
    lines.push("");
  }
  if (lapsed.length) {
    lines.push(
      'These are past their "until", so they no longer hold. Don\'t follow them unless a person keeps them again.',
      "",
    );
    for (const d of lapsed)
      lines.push(
        `- ${flat(d.decision)} (until ${flat(d.until ?? "")}${d.who ? `, ${flat(d.who)}` : ""})`,
      );
    lines.push("");
  }
  if (findings.length) {
    lines.push(
      HEADINGS[kind].facts ??
        "Facts people kept about this repo. Treat them as settled unless a source you read now says otherwise.",
      "",
    );
    for (const f of findings) {
      const on = where(f.scope, f.on);
      const meta = [
        f.source ? `source: ${flat(f.source)}` : null,
        on ? `on ${flat(on)}` : null,
      ].filter(Boolean);
      lines.push(`- ${flat(f.claim)}${meta.length ? ` (${meta.join(", ")})` : ""}`);
    }
    lines.push("");
  }
  lines.push(end);
  return lines.join("\n");
}

/**
 * `CLAUDE.md` with the block in place: replaced where it was, added at the
 * end when it's new, taken out when there's nothing to say. Null when the
 * file needn't exist: no file before, and no block to put in it.
 */
export function withBlock(
  file: string | null,
  block: string | null,
  kind: BlockKind = "team",
): string | null {
  const [BEGIN, END] = markers(kind);
  const text = file ?? "";
  const begin = text.indexOf(BEGIN);
  const end = begin >= 0 ? text.indexOf(END, begin) : -1;
  if (begin >= 0 && end >= 0) {
    const before = text.slice(0, begin);
    const after = text.slice(end + END.length);
    if (block) return before + block + after;
    // Taken out with the blank line that set it apart, so the file is as it was.
    const out = before.replace(/\n\n$/, "\n") + after.replace(/^\n/, "");
    return out === "" && file === null ? null : out;
  }
  if (!block) return file;
  if (!text.trim()) return `${block}\n`;
  return `${text.replace(/\n*$/, "")}\n\n${block}\n`;
}
