import type { SyntaxNode, Tree } from "@lezer/common";
import { markdownParser } from "../markdown/index.ts";
import { readWikiLink } from "../markdown/wikilink.ts";
import type { Range, Section, SectionId, SectionLink } from "./section.ts";

/**
 * Builds a doc's section tree from its Markdown (Data Model, "From file to
 * sections to map").
 *
 * - Each top-level heading starts a section; headings inside quotes,
 *   callouts or lists are text, as in Obsidian's outline.
 * - The title section is the root. When the doc's first heading is an H1
 *   with nothing but blank lines before it, that H1 is the title's heading;
 *   otherwise the title has no heading and is named after the file.
 * - Text before the first other heading belongs to the title.
 * - Frontmatter belongs to the file and is never in a section.
 * - A later H1 is a section under the title, at level 1.
 *
 * The open doc passes the editor's own parse tree, so the page and its
 * sections can never disagree; anything else lets this parse the text.
 */

/** A wiki link in a section's own text, resolved within the doc when it can be. */
export type TreeLink = Omit<SectionLink, "resolved"> & {
  /** True when the link points into this same doc. */
  sameDoc: boolean;
  /** The section it points to in this doc, by index; null when elsewhere, a block, or broken. */
  targetIndex: number | null;
};

export type SectionNode = {
  index: number;
  parent: number | null;
  children: number[];
  source: "markdown";
  path: string[];
  level: number;
  ordinal: number;
  order: number;
  headingRange: Range | null;
  ownRange: Range;
  subtreeRange: Range;
  linksOut: TreeLink[];
};

export type SectionTree = {
  /** Frontmatter, when the file has it; never part of a section. */
  frontmatter: Range | null;
  /** From the first non-blank character after any frontmatter to the end. */
  body: Range;
  /** Every section in document order; index 0 is the title. */
  sections: SectionNode[];
};

type Heading = { from: number; to: number; level: number; text: string };

const HEADING = /^(ATXHeading|SetextHeading)([1-6])$/;

function headingText(doc: string, node: SyntaxNode): string {
  let from = node.from;
  let to = node.to;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name !== "HeaderMark") continue;
    if (child.from === node.from) from = child.to;
    else to = Math.min(to, child.from);
  }
  return doc.slice(from, to).replace(/\s+/g, " ").trim();
}

/** Only headings that are direct children of the document. */
function topLevelHeadings(
  doc: string,
  tree: Tree,
): { headings: Heading[]; frontmatter: Range | null } {
  const headings: Heading[] = [];
  let frontmatter: Range | null = null;
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    if (node.name === "Frontmatter") frontmatter = { from: node.from, to: node.to };
    const m = HEADING.exec(node.name);
    if (m?.[2])
      headings.push({
        from: node.from,
        to: node.to,
        level: Number(m[2]),
        text: headingText(doc, node),
      });
  }
  return { headings, frontmatter };
}

function firstNonBlank(doc: string, from: number): number {
  const m = /\S/.exec(doc.slice(from));
  return m ? from + m.index : doc.length;
}

/** The file name a doc is called by in links: `Notes` for `notes/Notes.md`. */
function linkName(fileName: string): string {
  return (fileName.split("/").pop() ?? fileName).replace(/\.md$/i, "");
}

export function buildSectionTree(
  doc: string,
  opts: { fileName: string; tree?: Tree },
): SectionTree {
  const tree = opts.tree ?? markdownParser.parse(doc);
  const { headings, frontmatter } = topLevelHeadings(doc, tree);
  const bodyFrom = firstNonBlank(doc, frontmatter ? frontmatter.to : 0);
  const body: Range = { from: bodyFrom, to: doc.length };

  const first = headings[0];
  const titleHeading = first && first.level === 1 && first.from === bodyFrom ? first : null;
  const rest = titleHeading ? headings.slice(1) : headings;

  const sections: SectionNode[] = [
    {
      index: 0,
      parent: null,
      children: [],
      source: "markdown",
      path: [titleHeading ? titleHeading.text : linkName(opts.fileName)],
      level: 1,
      ordinal: 0,
      order: 0,
      headingRange: titleHeading ? { from: titleHeading.from, to: titleHeading.to } : null,
      ownRange: { from: bodyFrom, to: rest[0]?.from ?? doc.length },
      subtreeRange: { ...body },
      linksOut: [],
    },
  ];

  // Nest by level under the title; the title sits below every level.
  const stack: { index: number; level: number }[] = [{ index: 0, level: 0 }];
  rest.forEach((h, i) => {
    while (stack.length > 1 && (stack.at(-1)?.level ?? 0) >= h.level) stack.pop();
    const parentIndex = stack.at(-1)?.index ?? 0;
    const parent = sections[parentIndex];
    if (!parent) throw new Error("section tree: missing parent");

    const next = rest[i + 1];
    const subtreeEnd = rest.slice(i + 1).find((n) => n.level <= h.level)?.from ?? doc.length;
    const siblings = parent.children.map((c) => sections[c]);
    const node: SectionNode = {
      index: sections.length,
      parent: parentIndex,
      children: [],
      source: "markdown",
      path: [...parent.path, h.text],
      level: h.level,
      ordinal: siblings.filter((s) => s?.path.at(-1) === h.text).length,
      order: siblings.length,
      headingRange: { from: h.from, to: h.to },
      ownRange: { from: h.from, to: next?.from ?? doc.length },
      subtreeRange: { from: h.from, to: subtreeEnd },
      linksOut: [],
    };
    parent.children.push(node.index);
    sections.push(node);
    stack.push({ index: node.index, level: h.level });
  });

  addLinks(doc, tree, opts.fileName, sections);
  return { frontmatter, body, sections };
}

/** The section whose own text holds this position. */
function ownerOf(sections: SectionNode[], pos: number): SectionNode | undefined {
  // Own ranges don't overlap and are in document order, except the title's, which starts first.
  for (let i = sections.length - 1; i >= 0; i--) {
    const s = sections[i];
    if (s && pos >= s.ownRange.from && pos < s.ownRange.to) return s;
  }
  return undefined;
}

/**
 * Resolve a heading reference the way Obsidian does: `A#B` names a heading B
 * somewhere under a heading A; the first match in document order wins, an
 * exact match before one that differs only in case. `^block` is not a section.
 */
export function resolveHeading(sections: readonly SectionNode[], heading: string): number | null {
  if (heading.startsWith("^")) return null;
  const want = heading
    .split("#")
    .map((p) => p.trim())
    .filter(Boolean);
  if (want.length === 0) return null;
  const matches = (path: string[], fold: boolean) => {
    const f = (s: string) => (fold ? s.toLowerCase() : s);
    if (f(path.at(-1) ?? "") !== f(want.at(-1) ?? "")) return false;
    let at = path.length - 2;
    for (let w = want.length - 2; w >= 0; w--) {
      while (at >= 0 && f(path[at] ?? "") !== f(want[w] ?? "")) at--;
      if (at < 0) return false;
      at--;
    }
    return true;
  };
  for (const fold of [false, true]) {
    const hit = sections.find((s) => s.headingRange && matches(s.path, fold));
    if (hit) return hit.index;
  }
  return null;
}

function addLinks(doc: string, tree: Tree, fileName: string, sections: SectionNode[]) {
  const self = linkName(fileName).toLowerCase();
  tree.iterate({
    enter(node) {
      if (node.name !== "WikiLink" && node.name !== "WikiEmbed") return;
      const owner = ownerOf(sections, node.from);
      const link = readWikiLink(doc.slice(node.from, node.to));
      if (!owner || !link) return false;
      const sameDoc = link.target === "" || linkName(link.target).toLowerCase() === self;
      owner.linksOut.push({
        range: { from: node.from, to: node.to },
        target: link.target,
        heading: link.heading,
        alias: link.alias,
        embed: link.embed,
        sameDoc,
        targetIndex: sameDoc ? (link.heading ? resolveHeading(sections, link.heading) : 0) : null,
      });
      return false;
    },
  });
}

/**
 * Section records for a tree, once each section has an ID (task 1.12 mints
 * them). Links within the doc resolve to IDs, and links in from the same doc
 * are filled in; links from other docs are added by the index (group 8).
 */
export function toSectionRecords(
  tree: SectionTree,
  doc: Section["doc"],
  ids: readonly SectionId[],
): Section[] {
  if (ids.length !== tree.sections.length) throw new Error("one ID per section");
  const idAt = (i: number) => {
    const id = ids[i];
    if (!id) throw new Error(`no ID for section ${String(i)}`);
    return id;
  };
  const linksIn = tree.sections.map(() => new Set<SectionId>());
  for (const s of tree.sections) {
    for (const l of s.linksOut) {
      if (l.targetIndex !== null && l.targetIndex !== s.index)
        linksIn[l.targetIndex]?.add(idAt(s.index));
    }
  }
  return tree.sections.map((s) => ({
    id: idAt(s.index),
    doc,
    source: s.source,
    path: s.path,
    level: s.level,
    ordinal: s.ordinal,
    order: s.order,
    headingRange: s.headingRange,
    ownRange: s.ownRange,
    subtreeRange: s.subtreeRange,
    linksOut: s.linksOut.map((l) => ({
      range: l.range,
      target: l.target,
      heading: l.heading,
      alias: l.alias,
      embed: l.embed,
      resolved: l.targetIndex === null ? null : idAt(l.targetIndex),
    })),
    linksIn: [...(linksIn[s.index] ?? [])],
  }));
}
