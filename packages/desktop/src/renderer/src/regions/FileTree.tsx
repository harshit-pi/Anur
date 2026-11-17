import { useMemo, useState } from "react";
import { buildTree, type TreeNode } from "../layout/file-tree.ts";

/** The folder's docs as a tree; folders open and close, a doc can be picked. */
export function FileTree({
  docs,
  offloaded = [],
  selected,
  onSelect,
}: {
  docs: readonly string[];
  /** Docs whose bytes are still in iCloud: marked, and fetched when opened. */
  offloaded?: readonly string[];
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const tree = useMemo(() => buildTree(docs), [docs]);
  const inCloud = useMemo(() => new Set(offloaded), [offloaded]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (path: string) => {
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const render = (nodes: TreeNode[], depth: number) =>
    nodes.map((n) =>
      n.kind === "folder" ? (
        <li key={n.path} role="treeitem" aria-expanded={open.has(n.path)}>
          <button
            type="button"
            className="tree-row"
            style={{ paddingLeft: 8 + depth * 14 }}
            title={n.path}
            onClick={() => {
              toggle(n.path);
            }}
          >
            <span className={open.has(n.path) ? "caret open" : "caret"} aria-hidden="true" />
            <span className="truncate">{n.name}</span>
          </button>
          {open.has(n.path) ? <ul role="group">{render(n.children, depth + 1)}</ul> : null}
        </li>
      ) : (
        <li key={n.path} role="treeitem" aria-selected={selected === n.path}>
          <button
            type="button"
            className={selected === n.path ? "tree-row doc selected" : "tree-row doc"}
            style={{ paddingLeft: 22 + depth * 14 }}
            title={inCloud.has(n.path) ? `${n.path} (in iCloud; downloads when opened)` : n.path}
            onClick={() => {
              onSelect(n.path);
            }}
          >
            <span className="truncate">{n.name}</span>
            {inCloud.has(n.path) ? (
              <span className="cloud-mark" aria-label="in iCloud">
                ☁
              </span>
            ) : null}
          </button>
        </li>
      ),
    );

  if (docs.length === 0) return <p className="quiet">No Markdown files in this folder yet.</p>;
  return (
    <ul className="tree" role="tree" aria-label="Docs">
      {render(tree, 0)}
    </ul>
  );
}
