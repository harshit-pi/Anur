import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import type { MenuEntry } from "../../../shared/ipc-contract.ts";
import { anur } from "../bridge.ts";
import {
  buildTree,
  docCount,
  dropTarget,
  folderOf,
  isViewable,
  renamed,
  type Sort,
  type TreeNode,
} from "../layout/file-tree.ts";

/** What the files panel can do to the folder; each resolves once the folder is read again. */
export type FileActions = {
  newDoc: (dir: string) => Promise<string | null>;
  newFolder: (dir: string) => Promise<string | null>;
  move: (from: string, to: string) => Promise<boolean>;
  duplicate: (path: string) => Promise<void>;
  trash: (path: string, isFolder: boolean, docs: number) => Promise<void>;
};

/** A request from the panel's header: make a doc or a folder where the keys are. */
export type MakeRequest = { kind: "doc" | "folder"; n: number };

/** A path being dragged in the tree, so drops from elsewhere are told apart. */
const DRAG_TYPE = "application/x-anur-path";

/**
 * The folder's docs and folders as a tree. A click opens a doc or a folder;
 * docs and folders are made, renamed, moved by dragging, copied and trashed
 * here, as in an IDE, by the header's buttons, a right-click, or the keys.
 */
export function FileTree({
  docs,
  folders = [],
  files = [],
  times = {},
  sort = "name",
  offloaded = [],
  selected,
  onSelect,
  reveal = 0,
  collapse = 0,
  actions,
  editable = false,
  request = null,
}: {
  docs: readonly string[];
  folders?: readonly string[];
  /** Attachments, such as images and PDFs, listed among the docs. */
  files?: readonly string[];
  times?: Readonly<Record<string, readonly [number, number]>>;
  sort?: Sort;
  /** Docs whose bytes are still in iCloud: marked, and fetched when opened. */
  offloaded?: readonly string[];
  selected: string | null;
  /** ⌘-click opens the doc in a new tab. */
  onSelect: (path: string, inNewTab: boolean) => void;
  /** Changes when a tab is pressed: reveal the doc in focus, even if it hasn't changed. */
  reveal?: number;
  /** Changes when Collapse All is pressed. */
  collapse?: number;
  actions?: FileActions | undefined;
  /** False in a read-only folder: nothing can be made, moved or trashed. */
  editable?: boolean;
  /** The header asked for a new doc or folder. */
  request?: MakeRequest | null;
}) {
  const tree = useMemo(
    () => buildTree(docs, folders, sort, times, files),
    [docs, folders, sort, times, files],
  );
  const folderSet = useMemo(() => new Set(folders), [folders]);
  const inCloud = useMemo(() => new Set(offloaded), [offloaded]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  /** The row the keys act on: the open doc, or the row last clicked. */
  const [focused, setFocused] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const dragging = useRef<string | null>(null);
  const hold = useRef<{ path: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const isFolder = (p: string) => folderSet.has(p);

  // The tree follows the doc in focus (2.15): its folders open, and its row
  // scrolls into view, whether a click, a tab, back or forward brought it,
  // and again whenever its tab is pressed, as in an IDE.
  const list = useRef<HTMLUListElement>(null);
  /** A reveal waiting for its row to be drawn, as when its folder was collapsed. */
  const scrollPending = useRef(false);
  const openTo = (p: string, self: boolean) => {
    const parts = p.split("/").slice(0, self ? undefined : -1);
    const ancestors = parts.map((_, i) => parts.slice(0, i + 1).join("/"));
    setOpen((s) => (ancestors.every((a) => s.has(a)) ? s : new Set([...s, ...ancestors])));
  };
  useEffect(() => {
    if (!selected) return;
    setFocused(selected);
    openTo(selected, false);
    scrollPending.current = true;
  }, [selected, reveal]);
  // Runs after every draw: once the doc's row exists, bring it into view.
  useEffect(() => {
    if (!scrollPending.current) return;
    const row = list.current?.querySelector(".tree-row.focused, .tree-row.selected");
    if (!row) return;
    scrollPending.current = false;
    row.scrollIntoView({ block: "nearest" });
  });
  useEffect(() => {
    if (collapse > 0) setOpen(new Set());
  }, [collapse]);
  const toggle = (path: string) => {
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const make = async (kind: "doc" | "folder", dir: string) => {
    if (!actions || !editable) return;
    const made = await (kind === "doc" ? actions.newDoc(dir) : actions.newFolder(dir));
    if (!made) return;
    if (dir) openTo(dir, true);
    setFocused(made);
    setEditing(made);
    scrollPending.current = true;
  };
  // The header's buttons make one where the keys are: in that folder, or beside that doc.
  const makeNow = useRef(make);
  makeNow.current = make;
  const focusedNow = useRef(focused);
  focusedNow.current = focused;
  useEffect(() => {
    if (!request) return;
    const at = focusedNow.current;
    void makeNow.current(request.kind, folderOf(at, at !== null && folderSet.has(at)));
    // Only a new request: a changed folder list must not make another.
  }, [request]);

  /** The row being named, read at blur: ↩ and Escape have already settled it by then. */
  const editingNow = useRef(editing);
  editingNow.current = editing;
  const finishRename = async (path: string, typed: string) => {
    if (editingNow.current !== path) return;
    editingNow.current = null;
    setEditing(null);
    const to = renamed(path, typed, isFolder(path));
    if (!actions || !to || to === path) return;
    if (await actions.move(path, to)) setFocused(to);
    list.current?.focus();
  };
  /** A doc or an image opens in a tab; any other file in its default app. */
  const openNode = (node: TreeNode, inNewTab: boolean) => {
    if (node.kind === "doc" || (node.kind === "file" && isViewable(node.path)))
      onSelect(node.path, inNewTab);
    else if (node.kind === "file")
      void anur.call("doc:reveal", { path: node.path, how: "default-app" });
  };
  const trash = (node: TreeNode) => {
    void actions?.trash(node.path, node.kind === "folder", docCount(node));
  };

  const rowMenu = (node: TreeNode) => {
    setFocused(node.path);
    const items: MenuEntry[] =
      node.kind === "folder"
        ? [
            { id: "new-doc", label: "New doc here", enabled: editable },
            { id: "new-folder", label: "New folder here", enabled: editable },
            { separator: true },
            { id: "rename", label: "Rename", enabled: editable },
            { separator: true },
            { id: "reveal", label: "Reveal in Finder" },
            { id: "copy-path", label: "Copy path" },
            { separator: true },
            { id: "trash", label: "Move to Trash", enabled: editable },
          ]
        : [
            ...(node.kind === "doc" || isViewable(node.path)
              ? [{ id: "open-tab", label: "Open in new tab" }]
              : []),
            ...(node.kind === "file" ? [{ id: "open-app", label: "Open in default app" }] : []),
            { separator: true },
            { id: "rename", label: "Rename", enabled: editable },
            { id: "duplicate", label: "Duplicate", enabled: editable },
            { separator: true },
            { id: "reveal", label: "Reveal in Finder" },
            { id: "copy-path", label: "Copy path" },
            { separator: true },
            { id: "trash", label: "Move to Trash", enabled: editable },
          ];
    void anur.call("menu:popup", { items }).then(({ id }) => {
      if (id === "new-doc") void make("doc", node.path);
      else if (id === "new-folder") void make("folder", node.path);
      else if (id === "rename") setEditing(node.path);
      else if (id === "reveal") void anur.call("doc:reveal", { path: node.path, how: "finder" });
      else if (id === "copy-path") void anur.call("clipboard:write", { text: node.path });
      else if (id === "trash") trash(node);
      else if (id === "open-tab") onSelect(node.path, true);
      else if (id === "open-app")
        void anur.call("doc:reveal", { path: node.path, how: "default-app" });
      else if (id === "duplicate") void actions?.duplicate(node.path);
    });
  };
  const blankMenu = () => {
    if (!editable) return;
    const items: MenuEntry[] = [
      { id: "new-doc", label: "New doc" },
      { id: "new-folder", label: "New folder" },
    ];
    void anur.call("menu:popup", { items }).then(({ id }) => {
      if (id === "new-doc") void make("doc", "");
      else if (id === "new-folder") void make("folder", "");
    });
  };

  // Dragging: a doc or folder onto a folder moves it there; onto a doc, into
  // that doc's folder; onto the space below the list, to the top.
  const intoOf = (node: TreeNode | null) =>
    node === null ? "" : node.kind === "folder" ? node.path : folderOf(node.path, false);
  const endDrag = () => {
    dragging.current = null;
    setDropOn(null);
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
  };
  const dragOver = (e: DragEvent, node: TreeNode | null) => {
    const from = dragging.current;
    if (!from || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
    const into = intoOf(node);
    if (!dropTarget(from, into)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDropOn(into);
    // Holding over a closed folder opens it, so a drop can go deeper.
    if (node?.kind === "folder" && !open.has(node.path) && hold.current?.path !== node.path) {
      if (hold.current) clearTimeout(hold.current.timer);
      hold.current = {
        path: node.path,
        timer: setTimeout(() => {
          setOpen((s) => new Set([...s, node.path]));
        }, 600),
      };
    }
  };
  const drop = (e: DragEvent, node: TreeNode | null) => {
    const from = dragging.current;
    if (!from) return;
    e.preventDefault();
    e.stopPropagation();
    endDrag();
    const into = intoOf(node);
    const to = dropTarget(from, into);
    if (!to || !actions) return;
    void actions.move(from, to).then((ok) => {
      if (!ok) return;
      if (into) openTo(into, true);
      setFocused(to);
    });
  };

  // Keys, while the tree has focus: ↑↓ move, ←→ fold, ↩ renames, ⌘⌫ trashes.
  const visible = (): TreeNode[] => {
    const out: TreeNode[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        out.push(n);
        if (n.kind === "folder" && open.has(n.path)) walk(n.children);
      }
    };
    walk(tree);
    return out;
  };
  const onKey = (e: KeyboardEvent) => {
    if (editing || (e.target as HTMLElement).tagName === "INPUT") return;
    const rows = visible();
    const at = rows.findIndex((n) => n.path === focused);
    const node = rows[at];
    const go = (n: TreeNode | undefined) => {
      if (!n) return;
      setFocused(n.path);
      scrollPending.current = true;
      if (n.kind === "doc" || (n.kind === "file" && isViewable(n.path))) onSelect(n.path, false);
    };
    if (e.key === "ArrowDown") go(at < 0 ? rows[0] : rows[at + 1]);
    else if (e.key === "ArrowUp") go(rows[at - 1]);
    else if (e.key === "ArrowRight" && node?.kind === "folder") {
      if (open.has(node.path)) go(node.children[0]);
      else toggle(node.path);
    } else if (e.key === "ArrowLeft" && node) {
      if (node.kind === "folder" && open.has(node.path)) toggle(node.path);
      else {
        const parent = folderOf(node.path, false);
        if (parent) setFocused(parent);
      }
    } else if (e.key === "Enter" && node && editable) setEditing(node.path);
    else if (e.key === "Backspace" && e.metaKey && node && editable) trash(node);
    else return;
    e.preventDefault();
  };

  const row = (n: TreeNode, depth: number) => {
    const isDoc = n.kind !== "folder";
    const classes = [
      "tree-row",
      isDoc ? "doc" : "",
      n.kind === "file" ? "file" : "",
      isDoc && selected === n.path ? "selected" : "",
      focused === n.path ? "focused" : "",
      !isDoc && dropOn === n.path ? "drop-into" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const pad = (isDoc ? 22 : 8) + depth * 14;
    const caret = isDoc ? null : (
      <span className={open.has(n.path) ? "caret open" : "caret"} aria-hidden="true" />
    );
    if (editing === n.path) {
      return (
        <div className={`${classes} renaming`} style={{ paddingLeft: pad }}>
          {caret}
          <input
            className="tree-rename"
            aria-label={`New name for ${n.name}`}
            defaultValue={n.name}
            autoFocus
            onFocus={(e) => {
              e.currentTarget.select();
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              // ↩ and Escape settle the name themselves; a click away settles it on blur.
              if (e.key === "Enter") void finishRename(n.path, e.currentTarget.value);
              if (e.key === "Escape") {
                editingNow.current = null;
                setEditing(null);
                list.current?.focus();
              }
            }}
            onBlur={(e) => {
              if (editingNow.current === n.path) void finishRename(n.path, e.currentTarget.value);
            }}
          />
        </div>
      );
    }
    return (
      <button
        type="button"
        className={classes}
        style={{ paddingLeft: pad }}
        title={inCloud.has(n.path) ? `${n.path} (in iCloud; downloads when opened)` : n.path}
        draggable={editable}
        onDragStart={(e) => {
          dragging.current = n.path;
          e.dataTransfer.setData(DRAG_TYPE, n.path);
          e.dataTransfer.setData("text/plain", n.path);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={endDrag}
        onDragOver={(e) => {
          dragOver(e, n);
        }}
        onDrop={(e) => {
          drop(e, n);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          rowMenu(n);
        }}
        onClick={(e) => {
          setFocused(n.path);
          if (isDoc) openNode(n, e.metaKey || e.ctrlKey);
          else toggle(n.path);
        }}
      >
        {caret}
        <span className="truncate">{n.name}</span>
        {n.kind === "file" && n.ext ? <span className="file-ext">{n.ext}</span> : null}
        {inCloud.has(n.path) ? (
          <span className="cloud-mark" aria-label="in iCloud">
            ☁
          </span>
        ) : null}
      </button>
    );
  };

  const render = (nodes: TreeNode[], depth: number) =>
    nodes.map((n) =>
      n.kind === "folder" ? (
        <li key={n.path} role="treeitem" aria-expanded={open.has(n.path)}>
          {row(n, depth)}
          {open.has(n.path) ? <ul role="group">{render(n.children, depth + 1)}</ul> : null}
        </li>
      ) : (
        <li key={n.path} role="treeitem" aria-selected={selected === n.path}>
          {row(n, depth)}
        </li>
      ),
    );

  if (tree.length === 0 && !editable)
    return <p className="quiet">No Markdown files in this folder yet.</p>;
  return (
    <ul
      className={dropOn === "" ? "tree drop-into" : "tree"}
      role="tree"
      aria-label="Docs"
      ref={list}
      tabIndex={-1}
      onKeyDown={onKey}
      onContextMenu={(e) => {
        e.preventDefault();
        blankMenu();
      }}
      onDragOver={(e) => {
        dragOver(e, null);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropOn(null);
      }}
      onDrop={(e) => {
        drop(e, null);
      }}
    >
      {tree.length === 0 ? (
        <li className="quiet tree-empty">No Markdown files in this folder yet.</li>
      ) : (
        render(tree, 0)
      )}
    </ul>
  );
}
