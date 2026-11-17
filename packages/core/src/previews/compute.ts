import type { Range, SectionId } from "../sections/section.ts";
import { applyHunks, diffLines, merge3, splitLines, type Hunk } from "../text/diff.ts";
import type { PreviewPart } from "./preview-file.ts";

/**
 * Previews from an edited copy (tasks 3.6, 3.8, 3.9). The agent edits a
 * working copy of the doc; the difference from the decided text becomes a
 * preview, one part per section it touches, each holding the text it was
 * made against so it can be applied onto newer typing.
 */

export type SectionSpan = { id: SectionId; path: string[]; subtreeRange: Range };

function lineStarts(lines: readonly string[]): number[] {
  const starts = [0];
  for (const l of lines) starts.push((starts.at(-1) ?? 0) + l.length);
  return starts;
}

/** The smallest section whose subtree holds `[from, to]`. */
function owner(sections: readonly SectionSpan[], from: number, to: number): number {
  let best = -1;
  let size = Infinity;
  sections.forEach((s, i) => {
    const r = s.subtreeRange;
    if (r.from <= from && to <= r.to && r.to - r.from < size) {
      best = i;
      size = r.to - r.from;
    }
  });
  return best;
}

/**
 * The parts that turn `decided` into `proposed`: each change goes to the
 * smallest section holding it, and a section's part is its subtree with
 * only those changes made.
 */
export function previewParts(
  decided: string,
  proposed: string,
  sections: readonly SectionSpan[],
): PreviewPart[] {
  const a = splitLines(decided);
  const b = splitLines(proposed);
  const at = lineStarts(a);
  const groups = new Map<number, { from: number; to: number; text: string }[]>();
  for (const h of diffLines(a, b)) {
    const from = at[h.aFrom] ?? decided.length;
    const to = at[h.aTo] ?? decided.length;
    // An insertion belongs with the text just before it: it continues that section.
    const i = from === to ? owner(sections, Math.max(0, from - 1), to) : owner(sections, from, to);
    if (i < 0) continue;
    const list = groups.get(i) ?? [];
    list.push({ from, to, text: b.slice(h.bFrom, h.bTo).join("") });
    groups.set(i, list);
  }
  return [...groups.entries()]
    .sort(([x], [y]) => x - y)
    .map(([i, edits]) => {
      const s = sections[i] as SectionSpan;
      const r = s.subtreeRange;
      let text = "";
      let pos = r.from;
      for (const e of edits) {
        text += decided.slice(pos, e.from) + e.text;
        pos = e.to;
      }
      text += decided.slice(pos, r.to);
      return { section: s.id, path: s.path, base: decided.slice(r.from, r.to), proposed: text };
    });
}

/** A part's own edits: what Show changes lists, each to accept or reject. */
export function partHunks(part: Pick<PreviewPart, "base" | "proposed">): {
  hunk: Hunk;
  removed: string;
  added: string;
}[] {
  const a = splitLines(part.base);
  const b = splitLines(part.proposed);
  return diffLines(a, b).map((hunk) => ({
    hunk,
    removed: a.slice(hunk.aFrom, hunk.aTo).join(""),
    added: b.slice(hunk.bFrom, hunk.bTo).join(""),
  }));
}

/** The part without the edits a person rejected; null when nothing is left to propose. */
export function rejectHunks<P extends Pick<PreviewPart, "base" | "proposed">>(
  part: P,
  rejected: readonly number[],
): P | null {
  const a = splitLines(part.base);
  const b = splitLines(part.proposed);
  const kept = diffLines(a, b).filter((_, i) => !rejected.includes(i));
  if (kept.length === 0) return null;
  return { ...part, proposed: applyHunks(a, b, kept) };
}

/**
 * The part made onto the section as it is now: its changes merged onto
 * newer typing. Where both changed the same lines, the person decides: it
 * comes back as needing a refresh.
 */
export function applyPart(
  current: string,
  part: Pick<PreviewPart, "base" | "proposed">,
  /** The person chose the thread's version where both changed the same lines. */
  force = false,
): { kind: "ok"; text: string } | { kind: "conflict" } {
  const merged = merge3(part.base, current, part.proposed, "theirs");
  return merged.conflicts > 0 && !force ? { kind: "conflict" } : { kind: "ok", text: merged.text };
}

/**
 * The doc with the preview's parts made: the text a thread's working copy
 * starts from. `locate` finds each part's section in `decided`; parts whose
 * section is gone, or that clash with newer text, are left out.
 */
export function withPreview(
  decided: string,
  parts: readonly PreviewPart[],
  locate: (part: PreviewPart) => Range | null,
): string {
  let text = decided;
  for (const part of parts) {
    const r = locate(part);
    if (!r) continue;
    const made = applyPart(decided.slice(r.from, r.to), part);
    if (made.kind !== "ok") continue;
    const theirs = decided.slice(0, r.from) + made.text + decided.slice(r.to);
    text = merge3(decided, text, theirs).text;
  }
  return text;
}
