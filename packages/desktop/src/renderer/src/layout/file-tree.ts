/**
 * The left sidebar's tree, built from the folder's doc paths: folders first,
 * then docs, each in the order the paths came, which main has already sorted.
 */
export type TreeNode =
  | { kind: "folder"; name: string; path: string; children: TreeNode[] }
  | { kind: "doc"; name: string; path: string };

export function buildTree(paths: readonly string[]): TreeNode[] {
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

  for (const p of paths) {
    const slash = p.lastIndexOf("/");
    const dir = slash < 0 ? "" : p.slice(0, slash);
    folderFor(dir).push({ kind: "doc", name: p.slice(slash + 1).replace(/\.md$/i, ""), path: p });
  }

  const order = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "folder" ? -1 : 1));
    for (const n of nodes) if (n.kind === "folder") order(n.children);
  };
  order(root);
  return root;
}

/** How many docs a folder holds, at any depth. */
export function docCount(node: TreeNode): number {
  return node.kind === "doc" ? 1 : node.children.reduce((n, c) => n + docCount(c), 0);
}
