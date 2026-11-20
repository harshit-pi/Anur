/**
 * Whether two proposed actions are the same work (30.39): every word that says
 * what the smaller one is about is in the other. "Draft the Roadmap page" and
 * "Draft the Roadmap and Milestones page" are the same; "Draft the Metrics
 * page" isn't. Verbs and filler every action shares don't count.
 */
const FILLER = new Set(
  "a an the and or of for to in on with page pages section doc docs note notes draft write make fill build check add create update new first".split(
    " ",
  ),
);

function about(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !FILLER.has(w)),
  );
}

export function sameWork(a: string, b: string): boolean {
  const [x, y] = [about(a), about(b)];
  const [small, big] = x.size <= y.size ? [x, y] : [y, x];
  if (small.size === 0) return a.trim().toLowerCase() === b.trim().toLowerCase();
  return [...small].every((w) => big.has(w));
}
