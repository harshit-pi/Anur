/**
 * The orphaned list (11.1): which live section a gone one most likely
 * became, by its heading and its last text. A suggestion only; the person
 * picks before anything moves.
 */

const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .replace(/^#+\s.*$/gm, "")
      .match(/[\p{L}\p{N}£$€]+/gu) ?? [],
  );

function bigrams(text: string): string[] {
  const t = text.toLowerCase().replace(/\s+/g, " ").trim();
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

/** Dice similarity of two headings, 0 to 1. */
export function headingLikeness(a: string, b: string): number {
  if (a.trim().toLowerCase() === b.trim().toLowerCase()) return 1;
  const x = bigrams(a);
  const y = bigrams(b);
  if (x.length === 0 || y.length === 0) return 0;
  const pool = new Map<string, number>();
  for (const g of x) pool.set(g, (pool.get(g) ?? 0) + 1);
  let shared = 0;
  for (const g of y) {
    const n = pool.get(g) ?? 0;
    if (n > 0) {
      shared++;
      pool.set(g, n - 1);
    }
  }
  return (2 * shared) / (x.length + y.length);
}

/** Share of words two texts have in common (Jaccard), 0 to 1. */
export function textLikeness(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / (x.size + y.size - shared);
}

/** Below this, no suggestion: the person picks a section themselves. */
export const SUGGEST_MIN = 0.3;

/**
 * The index of the live section most like a gone one, or null. Text counts
 * for more than the heading, since a rename keeps the text; without a last
 * text, the heading alone decides.
 */
export function suggestMatch(
  gone: { path: readonly string[]; text: string | null },
  live: { path: readonly string[]; text: string }[],
): number | null {
  const heading = gone.path.at(-1) ?? "";
  let best: { i: number; score: number } | null = null;
  for (const [i, s] of live.entries()) {
    const h = headingLikeness(heading, s.path.at(-1) ?? "");
    const score = gone.text ? 0.35 * h + 0.65 * textLikeness(gone.text, s.text) : h;
    if (!best || score > best.score) best = { i, score };
  }
  return best && best.score >= SUGGEST_MIN ? best.i : null;
}
