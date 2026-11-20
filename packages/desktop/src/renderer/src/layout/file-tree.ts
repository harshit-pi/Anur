/**
 * The left sidebar's tree, built from the folder's doc and folder paths:
 * folders first, then docs, in the order the sort asks for. Paths come
 * sorted by name from main.
 */
export type TreeNode =
  | { kind: "folder"; name: string; path: string; children: TreeNode[] }
  | { kind: "doc"; name: string; path: string }
  /** An attachment, such as an image or a PDF: its name without the ending, and the ending. */
  | { kind: "file"; name: string; ext: string; path: string };

/** Attachments that open in a tab of their own; the rest open in their default app. */
/** An Excalidraw drawing: Obsidian's `.excalidraw.md`, or a plain `.excalidraw`. */
export const isDrawing = (p: string) => /\.excalidraw(\.md)?$/i.test(p);
export const isViewable = (p: string) => /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(p);

export const SORTS = ["name", "name-desc", "modified", "created"] as const;
export type Sort = (typeof SORTS)[number];

export function buildTree(
  paths: readonly string[],
  folderPaths: readonly string[] = [],
  sort: Sort = "name",
  times: Readonly<Record<string, readonly [number, number]>> = {},
  files: readonly string[] = [],
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

  // Drawings stay out of the tree, as Excalidraw's own files would in Obsidian's list;
  // a folder emptied only by that goes too, so `Excalidraw/` doesn't show bare.
  const drawingDirs = new Set<string>();
  const keep = (p: string) => {
    if (!isDrawing(p)) return true;
    for (let d = p; d.includes("/");) drawingDirs.add((d = d.slice(0, d.lastIndexOf("/"))));
    return false;
  };
  const docs = paths.filter(keep);
  const attachments = files.filter(keep);
  for (const f of folderPaths) folderFor(f);
  for (const p of docs) {
    const slash = p.lastIndexOf("/");
    const dir = slash < 0 ? "" : p.slice(0, slash);
    folderFor(dir).push({ kind: "doc", name: p.slice(slash + 1).replace(/\.md$/i, ""), path: p });
  }
  for (const p of attachments) {
    const slash = p.lastIndexOf("/");
    const base = p.slice(slash + 1);
    const dot = base.lastIndexOf(".");
    folderFor(slash < 0 ? "" : p.slice(0, slash)).push({
      kind: "file",
      name: dot > 0 ? base.slice(0, dot) : base,
      ext: dot > 0 ? base.slice(dot + 1).toLowerCase() : "",
      path: p,
    });
  }

  const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
  const byName = (a: TreeNode, b: TreeNode) =>
    collator.compare(a.name, b.name) * (sort === "name-desc" ? -1 : 1);
  const at = (n: TreeNode) => times[n.path]?.[sort === "created" ? 1 : 0] ?? 0;
  const docOrder = (a: TreeNode, b: TreeNode) =>
    sort === "modified" || sort === "created" ? at(b) - at(a) || byName(a, b) : byName(a, b);
  const order = (nodes: TreeNode[]) => {
    // Folders first; docs and attachments together, as Obsidian lists them.
    nodes.sort((a, b) =>
      (a.kind === "folder") !== (b.kind === "folder")
        ? a.kind === "folder"
          ? -1
          : 1
        : a.kind === "folder"
          ? byName(a, b)
          : docOrder(a, b) || a.path.localeCompare(b.path),
    );
    for (const n of nodes) if (n.kind === "folder") order(n.children);
  };
  const prune = (nodes: TreeNode[]): TreeNode[] =>
    nodes.flatMap((n): TreeNode[] => {
      if (n.kind !== "folder") return [n];
      n.children = prune(n.children);
      return n.children.length === 0 && drawingDirs.has(n.path) ? [] : [n];
    });
  const kept = drawingDirs.size ? prune(root) : root;
  order(kept);
  return kept;
}

/** How many docs and files a folder holds, at any depth. */
export function docCount(node: TreeNode): number {
  return node.kind === "folder" ? node.children.reduce((n, c) => n + docCount(c), 0) : 1;
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

/** A name typed in the tree, made a path beside the old one; a doc or file keeps its ending. */
export function renamed(path: string, typed: string, isFolder: boolean): string | null {
  const dot = path.lastIndexOf(".");
  const ending = isFolder || dot <= path.lastIndexOf("/") ? "" : path.slice(dot);
  const name = typed
    .replace(/[\\/:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  if (!name) return null;
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
  if (isFolder) return `${dir}${name}`;
  const want = ending || ".md";
  return `${dir}${name}${name.toLowerCase().endsWith(want.toLowerCase()) ? "" : want}`;
}

/** The rows from `a` to `b`, either way round, as ⇧-click picks them. */
export function rangeBetween(rows: readonly string[], a: string, b: string): string[] {
  const i = rows.indexOf(a);
  const j = rows.indexOf(b);
  if (i < 0 || j < 0) return [b];
  return rows.slice(Math.min(i, j), Math.max(i, j) + 1);
}

/** Picked paths without any inside a picked folder, which go along with it. */
export function topmost(paths: readonly string[]): string[] {
  return paths.filter((p) => !paths.some((q) => q !== p && p.startsWith(`${q}/`)));
}
