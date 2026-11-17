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

const apply = (text: string, s: Span) => text.slice(0, s.from) + s.insert + text.slice(s.to);

/**
 * Merge `theirs` (the file now) with `mine` (the page), both grown from
 * `base` (what Anur last read or saved). `clash` means unsaved typing
 * overlapped the outside change and the file's version was taken.
 */
export function mergeOutside(
  base: string,
  mine: string,
  theirs: string,
): { text: string; clash: boolean } {
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
  return { text: theirs, clash: true };
}
