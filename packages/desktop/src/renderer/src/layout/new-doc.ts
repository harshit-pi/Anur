/**
 * Where a new doc goes and what it's called (2.26): beside the doc that's
 * open, else at the folder's top; named as typed, else "Untitled", with a
 * number added when a doc already has that name.
 */
export function newDocPath(docs: readonly string[], near: string | null, name = ""): string {
  const dir = near?.includes("/") ? near.slice(0, near.lastIndexOf("/") + 1) : "";
  const base =
    name
      .replace(/\.md$/i, "")
      .replace(/[\\/:*?"<>|#^[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^\.+/, "") || "Untitled";
  const taken = new Set(docs.map((d) => d.toLowerCase()));
  for (let n = 1; ; n++) {
    const candidate = `${dir}${n === 1 ? base : `${base} ${String(n)}`}.md`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** Docs whose name holds the query, the closest first: a name starting with it, then the shortest. */
export function docsNamed(docs: readonly string[], query: string, limit = 20): string[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  const name = (d: string) => (d.split("/").pop() ?? d).replace(/\.md$/i, "").toLowerCase();
  return docs
    .filter((d) => name(d).includes(q))
    .sort(
      (a, b) =>
        Number(name(b).startsWith(q)) - Number(name(a).startsWith(q)) ||
        name(a).length - name(b).length ||
        a.localeCompare(b),
    )
    .slice(0, limit);
}
