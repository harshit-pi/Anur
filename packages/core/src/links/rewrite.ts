import { markdownParser } from "../markdown/index.ts";
import { dirOf, resolveHref, resolveWiki, stripMd, type LinkTarget } from "./resolve.ts";

/**
 * Links that a rename or move broke, written again to reach the same doc.
 * A link is left alone while it still reaches its doc from where the linking
 * doc now is: `[[Plan]]` survives a move to another folder, so only links
 * whose name or path no longer resolves change. Wiki links keep their style
 * (a bare name stays a name when that's enough), heading and alias;
 * Markdown links stay relative and keep their heading.
 */

export type Move = { from: string; to: string };

type Found = { from: number; to: number; text: string; kind: "wiki" | "href" };

/** The doc-pointing parts of every link in the text: wiki targets and Markdown link addresses. */
function linkTargets(text: string): Found[] {
  const out: Found[] = [];
  markdownParser.parse(text).iterate({
    enter(node) {
      if (node.name === "WikiLinkTarget") {
        out.push({
          from: node.from,
          to: node.to,
          text: text.slice(node.from, node.to),
          kind: "wiki",
        });
      } else if (node.name === "URL" && /^(Link|Image)$/.test(node.node.parent?.name ?? "")) {
        out.push({
          from: node.from,
          to: node.to,
          text: text.slice(node.from, node.to),
          kind: "href",
        });
      }
    },
  });
  return out;
}

const docOf = (t: LinkTarget) => (t.kind === "doc" ? t.path : null);

/** A path from the folder `dir` to `to`, as a Markdown link writes it. */
function relative(dir: string, to: string): string {
  const a = dir ? dir.split("/") : [];
  const b = to.split("/");
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
}

function newWiki(written: string, target: string, after: readonly string[], at: string): string {
  const keepMd = /\.md$/i.test(written);
  const name = stripMd(target.split("/").pop() ?? target);
  const byName = !written.includes("/") && docOf(resolveWiki(after, at, name, null)) === target;
  const bare = byName ? name : stripMd(target);
  return keepMd ? `${bare}.md` : bare;
}

function newHref(written: string, target: string, at: string): string {
  const angled = written.startsWith("<") && written.endsWith(">");
  const raw = angled ? written.slice(1, -1) : written;
  const hash = raw.indexOf("#");
  const heading = hash < 0 ? "" : raw.slice(hash);
  const pathPart = hash < 0 ? raw : raw.slice(0, hash);
  let path = relative(dirOf(at), target);
  if (!/\.md$/i.test(pathPart)) path = stripMd(path);
  if (pathPart.startsWith("./") && !path.startsWith("..")) path = `./${path}`;
  if (angled) return `<${path}${heading}>`;
  const encoded = pathPart.includes("%20") || /\s/.test(path) ? encodeURI(path) : path;
  return `${encoded}${heading}`;
}

/**
 * The doc's text with its broken links written again, and how many changed.
 * `before` and `after` are the folder's docs before and after the moves;
 * `was` and `now` are this doc's own path before and after.
 */
export function rewriteLinks(
  text: string,
  was: string,
  now: string,
  moves: readonly Move[],
  before: readonly string[],
  after: readonly string[],
): { text: string; changed: number } {
  const moved = new Map(moves.map((m) => [m.from, m.to]));
  const edits: { from: number; to: number; insert: string }[] = [];
  for (const link of linkTargets(text)) {
    const resolve = (docs: readonly string[], at: string) =>
      docOf(
        link.kind === "wiki"
          ? resolveWiki(docs, at, link.text, null)
          : resolveHref(docs, at, link.text),
      );
    const target = resolve(before, was);
    if (target === null) continue;
    const goal = moved.get(target) ?? target;
    if (resolve(after, now) === goal) continue;
    const insert =
      link.kind === "wiki" ? newWiki(link.text, goal, after, now) : newHref(link.text, goal, now);
    if (insert !== link.text) edits.push({ from: link.from, to: link.to, insert });
  }
  let out = text;
  for (const e of [...edits].reverse()) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
  return { text: out, changed: edits.length };
}

/** The folder's docs as they were before the moves, from the list after them. */
export function docsBefore(after: readonly string[], moves: readonly Move[]): string[] {
  const arrived = new Set(moves.map((m) => m.to));
  return [...after.filter((d) => !arrived.has(d)), ...moves.map((m) => m.from)];
}
