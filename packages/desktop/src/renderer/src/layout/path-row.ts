import type { SectionTree } from "@anur/core";
import type { MenuEntry } from "../../../shared/ipc-contract.ts";
import { buildTree, type TreeNode } from "./file-tree.ts";

/**
 * The path row above the page: a breadcrumb whose folders open a menu of
 * what's inside them, a button that copies a link to the section at the
 * cursor, and a menu of doc actions.
 */

/** Menu ids for docs carry this prefix; the rest is the doc's path. */
export const DOC_ITEM = "doc:";

function entries(nodes: TreeNode[], current: string | null): MenuEntry[] {
  return nodes.map((n) =>
    n.kind === "folder"
      ? { label: n.name, submenu: entries(n.children, current) }
      : { id: `${DOC_ITEM}${n.path}`, label: n.name, checked: n.path === current },
  );
}

/** What is directly inside `folder` ("" for the top): its folders as submenus, then its docs. */
export function folderMenu(
  docs: readonly string[],
  folder: string,
  current: string | null,
): MenuEntry[] {
  let nodes = buildTree(docs);
  for (const part of folder ? folder.split("/") : []) {
    const next = nodes.find((n) => n.kind === "folder" && n.name === part);
    if (!next || next.kind !== "folder") return [];
    nodes = next.children;
  }
  return entries(nodes, current);
}

/** The breadcrumb's segments: each folder on the way, then the doc, with the folder each one lists. */
export function crumbs(docPath: string): { label: string; lists: string }[] {
  const parts = docPath.replace(/\.md$/i, "").split("/");
  return parts.map((label, i) => ({
    label,
    // A folder lists what's inside it; the doc lists what's beside it.
    lists: parts.slice(0, i === parts.length - 1 ? i : i + 1).join("/"),
  }));
}

/** The section the cursor at `pos` is in: the last one starting at or before it. */
export function sectionAt(tree: SectionTree, pos: number) {
  let found = tree.sections[0] ?? null;
  for (const s of tree.sections) if (s.ownRange.from <= pos) found = s;
  return found;
}

/**
 * A link to a doc, or a section of it, as Obsidian writes one: by the doc's
 * name, or by its path where another doc shares the name.
 */
export function wikiLinkTo(
  docs: readonly string[],
  docPath: string,
  heading: string | null,
): string {
  const name = (docPath.split("/").pop() ?? docPath).replace(/\.md$/i, "");
  const same = docs.filter((d) => (d.split("/").pop() ?? d).replace(/\.md$/i, "") === name);
  const target = same.length > 1 ? docPath.replace(/\.md$/i, "") : name;
  return heading ? `[[${target}#${heading}]]` : `[[${target}]]`;
}
