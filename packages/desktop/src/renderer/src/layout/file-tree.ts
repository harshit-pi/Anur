/**
 * The left sidebar's tree, built from the folder's doc and folder paths:
 * folders first, then docs, in the order the sort asks for. Paths come
 * sorted by name from main.
 */
export type TreeNode =
  | { kind: "folder"; name: string; path: string; children: TreeNode[] }
  | { kind: "doc"; name: string; path: string };

export const SORTS = ["name", "name-desc", "modified", "created"] as const;
export type Sort = (typeof SORTS)[number];

export function buildTree(
  paths: readonly string[],
  folderPaths: readonly string[] = [],
  sort: Sort = "name",
  times: Readonly<Record<string, readonly [number, number]>> = {},
): TreeNode[] {
  const root: TreeNode[] = [];
  const folders = new Map<string, TreeNode[]>([["", root]]);

  const folderFor = (dir: string): TreeNode[] => {
    const existing = folders.get(dir);
    if (existing) return existing;
    const slash = dir.lastIndexOf("/");
    const parent = folderFor(slash < 0 ? "" : dir.slice(0, slash));
    const children: TreeNode[] = [];
    parent.push({ kind: "folder", name: dir.slice(slash + 1), path: dir, children });
    folders.set(dir, children);
    return children;
  };

  for (const f of folderPaths) folderFor(f);
  for (const p of paths) {
    const slash = p.lastIndexOf("/");
    const dir = slash < 0 ? "" : p.slice(0, slash);
    folderFor(dir).push({ kind: "doc", name: p.slice(slash + 1).replace(/\.md$/i, ""), path: p });
  }

  const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
  const byName = (a: TreeNode, b: TreeNode) =>
    collator.compare(a.name, b.name) * (sort === "name-desc" ? -1 : 1);
  const at = (n: TreeNode) => times[n.path]?.[sort === "created" ? 1 : 0] ?? 0;
  const docOrder = (a: TreeNode, b: TreeNode) =>
    sort === "modified" || sort === "created" ? at(b) - at(a) || byName(a, b) : byName(a, b);
  const order = (nodes: TreeNode[]) => {
    nodes.sort((a, b) =>
      a.kind !== b.kind
        ? a.kind === "folder"
          ? -1
          : 1
        : a.kind === "folder"
          ? collator.compare(a.name, b.name) * (sort === "name-desc" ? -1 : 1)
          : docOrder(a, b),
    );
    for (const n of nodes) if (n.kind === "folder") order(n.children);
  };
  order(root);
  return root;
}

/** How many docs a folder holds, at any depth. */
export function docCount(node: TreeNode): number {
  return node.kind === "doc" ? 1 : node.children.reduce((n, c) => n + docCount(c), 0);
}

/** The folder a new doc or folder goes in: the folder itself, or a doc's folder. */
export const folderOf = (path: string | null, isFolder: boolean): string =>
  path === null
    ? ""
    : isFolder
      ? path
      : path.includes("/")
        ? path.slice(0, path.lastIndexOf("/"))
        : "";

/** "Name", "Name 2", … : the first that isn't taken, case ignored. */
export function freeName(taken: readonly string[], dir: string, base: string, ext = ""): string {
  const has = new Set(taken.map((t) => t.toLowerCase()));
  for (let n = 1; ; n++) {
    const name = `${base}${n === 1 ? "" : ` ${String(n)}`}${ext}`;
    const full = dir ? `${dir}/${name}` : name;
    if (!has.has(full.toLowerCase())) return full;
  }
}

/** Where a doc or folder lands when dropped on a folder ("" is the top), or null if it can't go. */
export function dropTarget(from: string, into: string): string | null {
  const name = from.slice(from.lastIndexOf("/") + 1);
  const to = into ? `${into}/${name}` : name;
  if (to === from || into === from || into.startsWith(`${from}/`)) return null;
  return to;
}

/** A name typed in the tree, made a path beside the old one; a doc keeps ".md". */
export function renamed(path: string, typed: string, isFolder: boolean): string | null {
  const name = typed
    .replace(/[\\/:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  if (!name) return null;
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
  return `${dir}${name}${isFolder || /\.md$/i.test(name) ? "" : ".md"}`;
}
