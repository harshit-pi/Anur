/**
 * Where a link goes (task 2.22). Wiki links find their doc as Obsidian does:
 * by path when they give one, otherwise by name anywhere in the folder, the
 * linking doc's own folder first, then the shortest path. Markdown links are
 * relative to the linking doc. Web and mail links leave the app.
 */

export type LinkTarget =
  | { kind: "doc"; path: string; heading: string | null }
  | { kind: "web"; url: string }
  | { kind: "missing"; name: string };

const stripMd = (p: string) => p.replace(/\.md$/i, "");
const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const nameOf = (p: string) => stripMd(p.split("/").pop() ?? p);

/** A wiki link's doc: `target` as written, such as "Doc", "Folder/Doc" or "" for this doc. */
export function resolveWiki(
  docs: readonly string[],
  from: string,
  target: string,
  heading: string | null,
): LinkTarget {
  const t = stripMd(target.trim().replace(/^\/+/, ""));
  if (t === "") return { kind: "doc", path: from, heading };
  const exact = docs.find((d) => stripMd(d).toLowerCase() === t.toLowerCase());
  if (exact) return { kind: "doc", path: exact, heading };
  const wanted = t.toLowerCase();
  const matches = docs.filter((d) => {
    const bare = stripMd(d).toLowerCase();
    return bare === wanted || bare.endsWith(`/${wanted}`);
  });
  if (matches.length === 0) return { kind: "missing", name: t };
  const here = dirOf(from);
  const best = [...matches].sort(
    (a, b) =>
      Number(dirOf(b) === here) - Number(dirOf(a) === here) ||
      a.split("/").length - b.split("/").length ||
      a.localeCompare(b),
  )[0];
  return best ? { kind: "doc", path: best, heading } : { kind: "missing", name: t };
}

/** A Markdown link's target: a web address, or a path relative to the linking doc. */
export function resolveHref(docs: readonly string[], from: string, href: string): LinkTarget {
  const raw = href.trim().replace(/^<|>$/g, "");
  if (/^(https?:|mailto:)/i.test(raw)) return { kind: "web", url: raw };
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return { kind: "missing", name: raw };
  const [pathPart = "", headingPart] = raw.split("#");
  let decoded = pathPart;
  try {
    decoded = decodeURI(pathPart);
  } catch {
    // Not valid percent-encoding: use it as written.
  }
  const heading = headingPart ? decodeURIComponent(headingPart).replace(/-/g, " ") : null;
  if (decoded === "") return { kind: "doc", path: from, heading };
  const start = decoded.startsWith("/") ? [] : dirOf(from).split("/").filter(Boolean);
  for (const part of decoded.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") start.pop();
    else start.push(part);
  }
  const joined = start.join("/");
  const found = docs.find((d) => d === joined || d === `${joined}.md`);
  return found ? { kind: "doc", path: found, heading } : { kind: "missing", name: decoded };
}

/** Heading text as links name it: case, spacing and the characters links can't hold ignored. */
export const headingKey = (h: string) =>
  h
    .replace(/[#|^:%[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export { nameOf };
