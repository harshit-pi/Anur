/**
 * Folding a change made outside Anur into the page (task 2.17). The file
 * always wins, but typing not yet saved is kept when it is on other lines
 * than what changed outside, as git merges; when it does, the page takes the file's version and
 * the toast's Undo brings back the person's.
 */

/** The one span that turns `a` into `b`: shared start and end left out. */
export type Span = { from: number; to: number; insert: string };

export function diffSpan(a: string, b: string): Span | null {
  if (a === b) return null;
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) {
    endA--;
    endB--;
  }
  return { from: start, to: endA, insert: b.slice(start, endB) };
}

/**
 * The change that turns the text at `offset` in the page from `a` into `b`,
 * touching only what differs, so unchanged lines are not rebuilt (no flash).
 */
export function changeWithin(offset: number, a: string, b: string): Span | null {
  const s = diffSpan(a, b);
  return s && { from: offset + s.from, to: offset + s.to, insert: s.insert };
}

const apply = (text: string, s: Span) => text.slice(0, s.from) + s.insert + text.slice(s.to);

/**
 * What a clash replaced: the overlapping lines as the person had them and as
 * the file has them now. Around them, both texts are the same as before.
 */
export type Kept = { mine: string; theirs: string; before: string; after: string };

/**
 * Merge `theirs` (the file now) with `mine` (the page), both grown from
 * `base` (what Anur last read or saved). `clash` means unsaved typing
 * overlapped the outside change and the file's version was taken; `kept`
 * then holds the person's version of those lines (2.18).
 */
export function mergeOutside(
  base: string,
  mine: string,
  theirs: string,
): { text: string; clash: boolean; kept?: Kept } {
  const ours = diffSpan(base, mine);
  const other = diffSpan(base, theirs);
  if (!ours || mine === theirs) return { text: theirs, clash: false };
  if (!other) return { text: mine, clash: false };
  // On different lines, as git merges: keep both, the later one first.
  const line = (pos: number) => base.slice(0, pos).split("\n").length;
  if (line(ours.to) < line(other.from)) {
    return { text: apply(apply(base, other), ours), clash: false };
  }
  if (line(other.to) < line(ours.from)) {
    return { text: apply(apply(base, ours), other), clash: false };
  }
  return { text: theirs, clash: true, kept: keptLines(base, mine, theirs, ours, other) };
}

/** The whole lines both changes touched, in each version. */
function keptLines(base: string, mine: string, theirs: string, ours: Span, other: Span): Kept {
  const start = base.lastIndexOf("\n", Math.min(ours.from, other.from) - 1) + 1;
  const endAt = base.indexOf("\n", Math.max(ours.to, other.to));
  const end = endAt < 0 ? base.length : endAt;
  const tail = base.length - end;
  return {
    mine: mine.slice(start, mine.length - tail),
    theirs: theirs.slice(start, theirs.length - tail),
    before: base.slice(lineBefore(base, start), start),
    after: base.slice(end, lineAfter(base, end)),
  };
}

/** Where the nearest non-blank line before `pos` starts. */
function lineBefore(text: string, pos: number): number {
  let at = pos;
  while (at > 0) {
    const start = text.lastIndexOf("\n", at - 2) + 1;
    if (text.slice(start, at).trim() !== "") return start;
    at = start;
  }
  return 0;
}

/** Where the nearest non-blank line after `pos` ends. */
function lineAfter(text: string, pos: number): number {
  let at = pos;
  while (at < text.length) {
    const nl = text.indexOf("\n", at + 1);
    const end = nl < 0 ? text.length : nl;
    if (text.slice(at, end).trim() !== "") return end;
    at = end;
  }
  return text.length;
}

/**
 * Put the person's kept lines back in place of the file's version, if that
 * version is still in the doc exactly once; otherwise null.
 */
export function putBack(doc: string, kept: Kept): Span | null {
  const at = doc.indexOf(kept.theirs);
  if (at < 0 || (kept.theirs !== "" && doc.indexOf(kept.theirs, at + 1) >= 0)) {
    // Not found, or found twice: try the text around it to find the place.
    const around = doc.indexOf(kept.before + kept.theirs + kept.after);
    if (around < 0) return null;
    const from = around + kept.before.length;
    return { from, to: from + kept.theirs.length, insert: kept.mine };
  }
  return { from: at, to: at + kept.theirs.length, insert: kept.mine };
}
