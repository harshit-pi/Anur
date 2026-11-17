/**
 * Line diffs and a three-way merge, for previews (Data Model, "Previews that
 * change more than one section"): a preview stores the text it was made
 * against, so it can always be rebased onto newer text, and only parts that
 * overlap newer text need a person to decide.
 *
 * Lines keep their line endings, so joining them gives the text back exactly.
 */

/** A text as lines, each with its own ending; the last may have none. */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.match(/[^\n]*\n|[^\n]+$/g);
  return lines ?? [];
}

/** One change: lines `[aFrom, aTo)` of the old text become lines `[bFrom, bTo)` of the new. */
export type Hunk = { aFrom: number; aTo: number; bFrom: number; bTo: number };

/** The hunks that turn `a` into `b`, smallest first, by Myers' algorithm. */
export function diffLines(a: readonly string[], b: readonly string[]): Hunk[] {
  // Trim what both share at the start and end; most edits are small.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const n = endA - start;
  const m = endB - start;
  if (n === 0 && m === 0) return [];
  if (n === 0 || m === 0) return [{ aFrom: start, aTo: endA, bFrom: start, bTo: endB }];

  const max = n + m;
  const offset = max;
  const v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0))
          ? (v[offset + k + 1] ?? 0)
          : (v[offset + k - 1] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[start + x] === b[start + y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }

  // Walk back through the trace for the edit path: a list of matched line pairs.
  const matches: [number, number][] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d > 0; d--) {
    const t = trace[d] ?? v;
    const k = x - y;
    const prevK =
      k === -d || (k !== d && (t[offset + k - 1] ?? 0) < (t[offset + k + 1] ?? 0)) ? k + 1 : k - 1;
    const prevX = t[offset + prevK] ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      matches.push([x, y]);
    }
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    matches.push([x, y]);
  }
  matches.reverse();

  const hunks: Hunk[] = [];
  let ax = 0;
  let by = 0;
  for (const [mx, my] of [...matches, [n, m] as [number, number]]) {
    if (mx > ax || my > by)
      hunks.push({ aFrom: start + ax, aTo: start + mx, bFrom: start + by, bTo: start + my });
    ax = mx + 1;
    by = my + 1;
  }
  return hunks;
}

/** `a` with some of the hunks that lead to `b` applied, the rest left as in `a`. */
export function applyHunks(
  a: readonly string[],
  b: readonly string[],
  hunks: readonly Hunk[],
): string {
  const out: string[] = [];
  let at = 0;
  for (const h of hunks) {
    out.push(...a.slice(at, h.aFrom), ...b.slice(h.bFrom, h.bTo));
    at = h.aTo;
  }
  out.push(...a.slice(at));
  return out.join("");
}

export type Merge3 = { text: string; conflicts: number };

/**
 * Merge two edits of `base`. Where only one side changed a stretch, that
 * side wins; where both changed the same stretch differently, it is a
 * conflict, resolved toward `prefer`, and counted.
 */
export function merge3(
  base: string,
  ours: string,
  theirs: string,
  prefer: "ours" | "theirs" = "ours",
): Merge3 {
  if (ours === theirs) return { text: ours, conflicts: 0 };
  if (base === ours) return { text: theirs, conflicts: 0 };
  if (base === theirs) return { text: ours, conflicts: 0 };
  const b = splitLines(base);
  const o = splitLines(ours);
  const t = splitLines(theirs);
  const ho = diffLines(b, o).map((h) => ({ ...h, side: "ours" as const }));
  const ht = diffLines(b, t).map((h) => ({ ...h, side: "theirs" as const }));
  const all = [...ho, ...ht].sort((x, y) => x.aFrom - y.aFrom || x.aTo - y.aTo);

  const out: string[] = [];
  let conflicts = 0;
  let at = 0;
  let i = 0;
  while (i < all.length) {
    // A group: hunks whose base ranges overlap, or touch at the same insertion point.
    const first = all[i];
    if (!first) break;
    let from = first.aFrom;
    let to = first.aTo;
    const group = [first];
    i++;
    while (i < all.length) {
      const h = all[i];
      if (
        !h ||
        !(
          h.aFrom < to ||
          (h.aFrom === to && (h.aFrom === h.aTo || from === to)) ||
          h.aFrom === from
        )
      )
        break;
      group.push(h);
      to = Math.max(to, h.aTo);
      from = Math.min(from, h.aFrom);
      i++;
    }
    out.push(...b.slice(at, from));
    const sideText = (side: "ours" | "theirs") => {
      const lines = side === "ours" ? o : t;
      const hs = group.filter((h) => h.side === side);
      if (hs.length === 0) return b.slice(from, to).join("");
      // The side's text for [from, to): its hunks, with the base lines between them.
      const parts: string[] = [];
      let pos = from;
      for (const h of hs) {
        parts.push(...b.slice(pos, h.aFrom), ...lines.slice(h.bFrom, h.bTo));
        pos = h.aTo;
      }
      parts.push(...b.slice(pos, to));
      return parts.join("");
    };
    const sides = new Set(group.map((h) => h.side));
    if (sides.size === 1) {
      out.push(sideText(first.side));
    } else {
      const so = sideText("ours");
      const st = sideText("theirs");
      if (so === st) out.push(so);
      else {
        conflicts++;
        out.push(prefer === "ours" ? so : st);
      }
    }
    at = to;
  }
  out.push(...b.slice(at));
  return { text: out.join(""), conflicts };
}
