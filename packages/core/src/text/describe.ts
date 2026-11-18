import { diffLines } from "./diff.ts";

/**
 * A one-line summary of what changed between two versions of a section
 * (5.4; FR8), read from the change itself: a word or two swapped is named,
 * otherwise the lines added, removed or rewritten are counted.
 */
export function describeChange(before: string | null, after: string): string {
  if (before === null) return "First version";
  if (before === after) return "No change";
  const a = before.trimEnd().split("\n");
  const b = after.trimEnd().split("\n");
  const hunks = diffLines(a, b);
  let added = 0;
  let removed = 0;
  let rewritten = 0;
  for (const h of hunks) {
    const out = h.aTo - h.aFrom;
    const into = h.bTo - h.bFrom;
    const both = Math.min(out, into);
    rewritten += both;
    removed += out - both;
    added += into - both;
  }
  // One line rewritten: name the words that changed.
  const [only] = hunks;
  if (hunks.length === 1 && only && only.aTo - only.aFrom === 1 && only.bTo - only.bFrom === 1) {
    const words = changedWords(a[only.aFrom] ?? "", b[only.bFrom] ?? "");
    if (words) return words;
  }
  const parts = [
    rewritten > 0 ? `rewrote ${plural(rewritten, "line")}` : "",
    added > 0 ? `added ${plural(added, "line")}` : "",
    removed > 0 ? `removed ${plural(removed, "line")}` : "",
  ].filter(Boolean);
  const said = parts.join(", ");
  return said ? said.charAt(0).toUpperCase() + said.slice(1) : "Changed spacing";
}

const plural = (n: number, noun: string) => `${String(n)} ${noun}${n === 1 ? "" : "s"}`;

/** "Changed “£4” to “£3”", when one short run of words differs. */
function changedWords(was: string, now: string): string | null {
  const w1 = was.split(/(\s+)/);
  const w2 = now.split(/(\s+)/);
  let start = 0;
  while (start < w1.length && start < w2.length && w1[start] === w2[start]) start++;
  let end1 = w1.length;
  let end2 = w2.length;
  while (end1 > start && end2 > start && w1[end1 - 1] === w2[end2 - 1]) {
    end1--;
    end2--;
  }
  const out = w1.slice(start, end1).join("").trim();
  const into = w2.slice(start, end2).join("").trim();
  if (out.length > 40 || into.length > 40) return null;
  if (!out && into) return `Added “${into}”`;
  if (out && !into) return `Removed “${out}”`;
  return out && into ? `Changed “${out}” to “${into}”` : null;
}
