import type { Element, InlineContext, MarkdownConfig } from "@lezer/markdown";
import { styleTags, tags } from "@lezer/highlight";

/**
 * Obsidian wiki links: `[[File]]`, `[[File#Heading]]`, `[[File#Heading|alias]]`,
 * `[[#Heading]]` within the same file, and embeds, `![[File]]`.
 * Inside a table cell Obsidian writes the alias bar as `\|`, so both count.
 * A link never spans lines and never contains `[` or `]`.
 */
export type WikiLink = {
  /** The file, as written, or "" for a link within the same file. */
  target: string;
  /** Everything after the first `#`, such as "Retry timing" or "A#B" or "^block". */
  heading: string | null;
  alias: string | null;
  embed: boolean;
};

const OPEN = 91; // [
const BANG = 33; // !

/** Where the alias bar is, as an offset into `inner`, and how wide (1 or 2 for `\|`). */
function findBar(inner: string): { at: number; width: number } | null {
  const i = inner.indexOf("|");
  if (i < 0) return null;
  return inner[i - 1] === "\\" ? { at: i - 1, width: 2 } : { at: i, width: 1 };
}

/** Read the parts of a wiki link from its source text, such as `[[A#B|c]]`. */
export function readWikiLink(raw: string): WikiLink | null {
  const embed = raw.startsWith("!");
  const body = embed ? raw.slice(1) : raw;
  if (!body.startsWith("[[") || !body.endsWith("]]")) return null;
  const inner = body.slice(2, -2);
  if (!isValidInner(inner)) return null;
  const bar = findBar(inner);
  const path = bar ? inner.slice(0, bar.at) : inner;
  const alias = bar ? inner.slice(bar.at + bar.width) : null;
  const hash = path.indexOf("#");
  return {
    target: (hash < 0 ? path : path.slice(0, hash)).trim(),
    heading: hash < 0 ? null : path.slice(hash + 1).trim(),
    alias: alias === null ? null : alias.trim(),
    embed,
  };
}

function isValidInner(inner: string): boolean {
  return inner.trim().length > 0 && !/[\n[\]]/.test(inner);
}

/** Build the node for a link whose `[[` starts at `open`; returns null when it isn't one. */
function parseAt(cx: InlineContext, start: number, open: number, embed: boolean): Element | null {
  const rest = cx.slice(open + 2, cx.end);
  const closeRel = rest.indexOf("]]");
  if (closeRel < 0) return null;
  const inner = rest.slice(0, closeRel);
  if (!isValidInner(inner)) return null;

  const innerFrom = open + 2;
  const close = innerFrom + closeRel;
  const bar = findBar(inner);
  const pathTo = bar ? innerFrom + bar.at : close;
  const hashRel = inner.slice(0, pathTo - innerFrom).indexOf("#");
  const targetTo = hashRel < 0 ? pathTo : innerFrom + hashRel;

  const children: Element[] = [];
  if (embed) children.push(cx.elt("WikiLinkMark", start, start + 1));
  children.push(cx.elt("WikiLinkMark", open, open + 2));
  if (targetTo > innerFrom) children.push(cx.elt("WikiLinkTarget", innerFrom, targetTo));
  if (hashRel >= 0) {
    children.push(cx.elt("WikiLinkMark", targetTo, targetTo + 1));
    if (pathTo > targetTo + 1) children.push(cx.elt("WikiLinkHeading", targetTo + 1, pathTo));
  }
  if (bar) {
    children.push(cx.elt("WikiLinkMark", pathTo, pathTo + bar.width));
    if (close > pathTo + bar.width) {
      children.push(cx.elt("WikiLinkAlias", pathTo + bar.width, close));
    }
  }
  children.push(cx.elt("WikiLinkMark", close, close + 2));
  return cx.elt(embed ? "WikiEmbed" : "WikiLink", start, close + 2, children);
}

export const WikiLinks: MarkdownConfig = {
  defineNodes: [
    "WikiLink",
    "WikiEmbed",
    "WikiLinkMark",
    "WikiLinkTarget",
    "WikiLinkHeading",
    "WikiLinkAlias",
  ],
  props: [
    styleTags({
      "WikiLink WikiEmbed": tags.link,
      WikiLinkMark: tags.processingInstruction,
      "WikiLinkTarget WikiLinkHeading": tags.url,
      WikiLinkAlias: tags.labelName,
    }),
  ],
  parseInline: [
    {
      name: "WikiEmbed",
      before: "Image",
      parse(cx, next, pos) {
        if (next !== BANG || cx.char(pos + 1) !== OPEN || cx.char(pos + 2) !== OPEN) return -1;
        const elt = parseAt(cx, pos, pos + 1, true);
        return elt ? cx.addElement(elt) : -1;
      },
    },
    {
      name: "WikiLink",
      before: "Link",
      parse(cx, next, pos) {
        if (next !== OPEN || cx.char(pos + 1) !== OPEN) return -1;
        const elt = parseAt(cx, pos, pos, false);
        return elt ? cx.addElement(elt) : -1;
      },
    },
  ],
};
