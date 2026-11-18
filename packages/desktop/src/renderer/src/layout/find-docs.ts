/**
 * The palette's doc search, as Obsidian's quick switcher and VS Code's file
 * picker work: every word typed, in any order, somewhere in the doc's name or
 * folder path. No cap: the list scrolls. Best first: the exact name, a name
 * that starts with what was typed, words matched at word starts and in the
 * name, docs opened recently, then shorter names.
 */
export function findDocs(
  docs: readonly string[],
  query: string,
  /** Recently opened docs, the latest first. */
  recent: readonly string[] = [],
): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const q = words.join(" ");
  const seen = new Map(recent.map((d, i) => [d, i]));
  const scored: { doc: string; score: number; name: string }[] = [];
  for (const doc of docs) {
    const path = doc.toLowerCase().replace(/\.md$/, "");
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (!words.every((w) => path.includes(w))) continue;
    let score = 0;
    if (name === q) score += 100;
    else if (name.startsWith(q)) score += 40;
    for (const w of words) {
      const at = name.indexOf(w);
      if (at >= 0) score += at === 0 || /[^a-z0-9]/.test(name[at - 1] ?? "") ? 6 : 3;
      else score += 1;
    }
    const r = seen.get(doc);
    if (r !== undefined) score += Math.max(2, 20 - r);
    scored.push({ doc, score, name });
  }
  return scored
    .sort(
      (a, b) => b.score - a.score || a.name.length - b.name.length || a.doc.localeCompare(b.doc),
    )
    .map((s) => s.doc);
}
