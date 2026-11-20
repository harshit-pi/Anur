import path from "node:path";

const headings = (text: string) =>
  new Set(
    [...text.matchAll(/^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm)].map((m) =>
      (m[1] ?? "").trim().toLowerCase(),
    ),
  );

/**
 * The section a new page was made for, when that section was removed from the
 * thread's doc while the thread ran (30.43); null when the page still belongs.
 * A page is for a section when it links to it (`[[Anur#Build Plan]]`), or when
 * its name is the section's, with or without the doc's name before it
 * ("Anur - Build Plan.md"). Newer wins, as for text: the removal stands.
 */
export function staleFor(
  page: string,
  pageText: string,
  doc: string,
  before: string,
  now: string,
): string | null {
  const was = headings(before);
  const is = headings(now);
  const gone = [...was].filter((h) => !is.has(h));
  if (gone.length === 0) return null;
  const docName = path.posix.basename(doc).replace(/\.md$/i, "").toLowerCase();
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const m of pageText.matchAll(
    new RegExp(`\\[\\[${esc(docName)}(?:\\.md)?#([^\\]|]+)`, "gi"),
  )) {
    const h = (m[1] ?? "").trim().toLowerCase();
    if (gone.includes(h)) return h;
  }
  const name = path.posix
    .basename(page)
    .replace(/\.md$/i, "")
    .toLowerCase()
    .replace(new RegExp(`^${esc(docName)}\\s*[-–—:]\\s*`), "")
    .trim();
  return gone.includes(name) ? name : null;
}
