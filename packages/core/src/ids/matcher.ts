import type { SectionId } from "../sections/section.ts";
import type { SectionTree } from "../sections/tree.ts";

/**
 * Matching sections after an edit made outside Anur, or a pull (task 1.13;
 * Data Model, "Keeping section IDs stable"). Changed sections are matched in
 * order:
 *
 * 1. the exact heading path;
 * 2. the same heading text at a new path;
 * 3. text similarity within the same file.
 *
 * Headings that share a path, such as two "Notes", are told apart by their
 * text; the ordinal is used only when minting. A section left without a match
 * goes to the orphaned list, with the most similar section as a suggestion.
 *
 * The result feeds `assignSectionIds` as carried IDs, which writes the renames,
 * mints and orphans.
 */

export type OldSection = { id: SectionId; path: readonly string[]; body: string };
export type NewSection = { path: readonly string[]; body: string };

export type MatchResult = {
  /** For each new section, the ID it keeps, or null to mint one. */
  carried: (SectionId | null)[];
  /** How each match was made, for the corpus test and for debugging. */
  how: ("path" | "heading" | "text" | null)[];
  /** Old sections with no match, each with its best suggestion among the new ones. */
  orphans: { id: SectionId; suggestion: number | null; score: number }[];
};

/** Below this, text alone never keeps an ID. */
export const MATCH_BAR = 0.5;
/** Below this, an orphan gets no suggestion. */
export const SUGGEST_BAR = 0.2;

function words(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text
    .toLowerCase()
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}]+/u)) {
    if (w.length > 0) out.add(w);
  }
  return out;
}

/** The Dice coefficient of two texts' word sets: 1 for the same words, 0 for none shared. */
export function similarity(a: string, b: string): number {
  const [wa, wb] = [words(a), words(b)];
  if (wa.size === 0 && wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return (2 * shared) / (wa.size + wb.size);
}

const pathKey = (p: readonly string[]) => p.join("\u0000");
const last = (p: readonly string[]) => p.at(-1) ?? "";

/** Pair up candidates by text, best first, each side used once. */
function pairByText(
  olds: number[],
  news: number[],
  old: readonly OldSection[],
  next: readonly NewSection[],
  bar: number,
): [number, number][] {
  const pairs: { o: number; n: number; s: number }[] = [];
  for (const o of olds) {
    for (const n of news) {
      const s = similarity(old[o]?.body ?? "", next[n]?.body ?? "");
      if (s >= bar) pairs.push({ o, n, s });
    }
  }
  pairs.sort((a, b) => b.s - a.s || a.o - b.o || a.n - b.n);
  const usedO = new Set<number>();
  const usedN = new Set<number>();
  const out: [number, number][] = [];
  for (const p of pairs) {
    if (usedO.has(p.o) || usedN.has(p.n)) continue;
    usedO.add(p.o);
    usedN.add(p.n);
    out.push([p.o, p.n]);
  }
  return out;
}

export function matchSections(
  old: readonly OldSection[],
  next: readonly NewSection[],
): MatchResult {
  const carried: (SectionId | null)[] = next.map(() => null);
  const how: MatchResult["how"] = next.map(() => null);
  const usedOld = new Set<number>();
  const take = (o: number, n: number, kind: "path" | "heading" | "text") => {
    const s = old[o];
    if (!s) return;
    usedOld.add(o);
    carried[n] = s.id;
    how[n] = kind;
  };
  const freeOld = () => old.map((_, i) => i).filter((i) => !usedOld.has(i));
  const freeNew = () => next.map((_, i) => i).filter((i) => carried[i] === null);

  // 1 and 2: group by a key; a group with one old and one new pairs directly,
  // a bigger group, such as two "Notes", pairs by text.
  for (const [kind, keyOf] of [
    ["path", pathKey],
    ["heading", last],
  ] as const) {
    const groups = new Map<string, { olds: number[]; news: number[] }>();
    for (const o of freeOld()) {
      const k = keyOf(old[o]?.path ?? []);
      const g = groups.get(k) ?? { olds: [], news: [] };
      g.olds.push(o);
      groups.set(k, g);
    }
    for (const n of freeNew()) {
      const g = groups.get(keyOf(next[n]?.path ?? []));
      if (g) g.news.push(n);
    }
    for (const { olds, news } of groups.values()) {
      const [o0] = olds;
      const [n0] = news;
      if (o0 === undefined || n0 === undefined) continue;
      if (olds.length === 1 && news.length === 1) take(o0, n0, kind);
      else {
        for (const [o, n] of pairByText(olds, news, old, next, 0)) take(o, n, kind);
      }
    }
  }

  // 3: text similarity within the file, above the bar.
  for (const [o, n] of pairByText(freeOld(), freeNew(), old, next, MATCH_BAR)) take(o, n, "text");

  const orphans = freeOld().map((o) => {
    let suggestion: number | null = null;
    let score = 0;
    next.forEach((n, i) => {
      const s = similarity(old[o]?.body ?? "", n.body);
      if (s > score) {
        score = s;
        suggestion = i;
      }
    });
    const id = old[o]?.id;
    if (!id) throw new Error("matchSections: missing ID");
    return score >= SUGGEST_BAR ? { id, suggestion, score } : { id, suggestion: null, score };
  });

  return { carried, how, orphans };
}

/**
 * A file holding merge-conflict markers: matching and Apply wait until the
 * conflict is resolved, so neither side's headings take a wrong ID.
 */
export function hasConflictMarkers(text: string): boolean {
  return /^<{7}(?: |$)/m.test(text) && /^={7}$/m.test(text) && /^>{7}(?: |$)/m.test(text);
}

/** Each section's own text without its heading line: what text similarity compares. */
export function sectionBodies(doc: string, tree: SectionTree): string[] {
  return tree.sections.map((s) => doc.slice(s.headingRange?.to ?? s.ownRange.from, s.ownRange.to));
}
