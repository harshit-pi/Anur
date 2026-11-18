import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import type { MenuEntry } from "../../../shared/ipc-contract.ts";
import { anur } from "../bridge.ts";
import {
  buildTree,
  docCount,
  dropTarget,
  folderOf,
  isViewable,
  rangeBetween,
  renamed,
  topmost,
  type Sort,
  type TreeNode,
} from "../layout/file-tree.ts";

/** What the files panel can do to the folder; each resolves once the folder is read again. */
export type FileActions = {
  newDoc: (dir: string) => Promise<string | null>;
  newFolder: (dir: string) => Promise<string | null>;
  /** Several moves as one: open docs wait, and links are offered once. */
  move: (moves: { from: string; to: string }[]) => Promise<boolean>;
  duplicate: (path: string) => Promise<void>;
  trash: (items: { path: string; isFolder: boolean; docs: number }[]) => Promise<void>;
  /** Copy files from anywhere, by full path, into a folder; resolves with the new paths. */
  importFiles: (sources: string[], into: string) => Promise<string[] | null>;
};

/** A request from the panel's header: make a doc or a folder where the keys are. */
export type MakeRequest = { kind: "doc" | "folder"; n: number };

/** A path being dragged in the tree, so drops from elsewhere are told apart. */
const DRAG_TYPE = "application/x-anur-path";

/** What ⌘C or ⌘X last put on the clipboard from the tree. */
type Clip = { mode: "copy" | "cut"; paths: string[] };

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
  /** Rows picked with ⌘- or ⇧-click, which menus, keys and drags act on together. */
  const [marked, setMarked] = useState<ReadonlySet<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  const dragging = useRef<string[] | null>(null);
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
    if (await actions.move([{ from: path, to }])) setFocused(to);
    list.current?.focus();
  };
  /** A doc or an image opens in a tab; any other file in its default app. */
  const openNode = (node: TreeNode, inNewTab: boolean) => {
    if (node.kind === "doc" || (node.kind === "file" && isViewable(node.path)))
      onSelect(node.path, inNewTab);
    else if (node.kind === "file")
      void anur.call("doc:reveal", { path: node.path, how: "default-app" });
  };
  const nodeAt = useMemo(() => {
    const map = new Map<string, TreeNode>();
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        map.set(n.path, n);
        if (n.kind === "folder") walk(n.children);
      }
    };
    walk(tree);
    return map;
  }, [tree]);
  /** What the keys and menus act on: the picked rows when the row is one of them, else the row. */
  const pickedWith = (path: string | null): string[] => {
    if (path === null) return [];
    if (marked.size > 1 && marked.has(path))
      return topmost(
        visible()
          .map((n) => n.path)
          .filter((p) => marked.has(p)),
      );
    return [path];
  };
  const trash = (paths: string[]) => {
    const items = paths.flatMap((p) => {
      const n = nodeAt.get(p);
      return n ? [{ path: p, isFolder: n.kind === "folder", docs: docCount(n) }] : [];
    });
    if (items.length) void actions?.trash(items);
  };
  const copyOut = (paths: string[], mode: Clip["mode"]) => {
    if (paths.length === 0) return;
    void anur.call("clipboard:write-files", { paths }).then(({ ok }) => {
      if (ok) setClip({ mode, paths });
    });
  };
  /** Paste into `into`: rows cut here move; anything copied, here or in Finder, is copied. */
  const paste = async (into: string) => {
    if (!actions || !editable) return;
    const { paths: onClip } = await anur.call("clipboard:read-files", {});
    const ours =
      clip !== null &&
      clip.paths.length === onClip.length &&
      clip.paths.every((p, i) => onClip[i]?.endsWith(`/${p}`));
    if (ours && clip.mode === "cut") {
      const moves = clip.paths.flatMap((from) => {
        const to = dropTarget(from, into);
        return to ? [{ from, to }] : [];
      });
      setClip(null);
      if (moves.length && (await actions.move(moves)))
        landed(
          into,
          moves.map((m) => m.to),
        );
      return;
    }
    if (onClip.length === 0) return;
    const made = await actions.importFiles(onClip, into);
    if (made?.length) landed(into, made);
  };
  /** After a paste, drop or move: open the folder and pick what arrived. */
  const landed = (into: string, paths: string[]) => {
    if (into) openTo(into, true);
    setMarked(new Set(paths.length > 1 ? paths : []));
    const last = paths[paths.length - 1];
    if (last) setFocused(last);
    scrollPending.current = true;
  };
  const intoFor = (path: string | null) => folderOf(path, path !== null && folderSet.has(path));

  const rowMenu = (node: TreeNode) => {
    setFocused(node.path);
    const picked = pickedWith(node.path);
    if (picked.length > 1) {
      const n = String(picked.length);
      void anur
        .call("menu:popup", {
          items: [
            { id: "cut", label: `Cut ${n} items`, enabled: editable },
            { id: "copy", label: `Copy ${n} items` },
            { separator: true },
            { id: "trash", label: `Move ${n} items to Trash`, enabled: editable },
          ],
        })
        .then(({ id }) => {
          if (id === "cut") copyOut(picked, "cut");
          else if (id === "copy") copyOut(picked, "copy");
          else if (id === "trash") trash(picked);
        });
      return;
    }
    setMarked(new Set());
    const clipItems: MenuEntry[] = [
      { id: "cut", label: "Cut", enabled: editable },
      { id: "copy", label: "Copy" },
      { id: "paste", label: "Paste", enabled: editable },
    ];
    const items: MenuEntry[] =
      node.kind === "folder"
        ? [
            { id: "new-doc", label: "New doc", enabled: editable },
            { id: "new-folder", label: "New folder", enabled: editable },
            { separator: true },
            { id: "rename", label: "Rename", enabled: editable },
            { separator: true },
            ...clipItems,
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
            ...clipItems,
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
      else if (id === "trash") trash([node.path]);
      else if (id === "cut") copyOut([node.path], "cut");
      else if (id === "copy") copyOut([node.path], "copy");
      else if (id === "paste") void paste(intoFor(node.path));
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
      { separator: true },
      { id: "paste", label: "Paste" },
    ];
    void anur.call("menu:popup", { items }).then(({ id }) => {
      if (id === "new-doc") void make("doc", "");
      else if (id === "new-folder") void make("folder", "");
      else if (id === "paste") void paste("");
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
  /** Files dragged in from Finder or another app, to be copied in. */
  const fromOutside = (e: DragEvent) =>
    !dragging.current && editable && e.dataTransfer.types.includes("Files");
  const dragOver = (e: DragEvent, node: TreeNode | null) => {
    const from = dragging.current;
    const into = intoOf(node);
    if (from) {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      if (!from.every((f) => dropTarget(f, into))) return;
    } else if (!fromOutside(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = from ? "move" : "copy";
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
    const into = intoOf(node);
    if (!from) {
      if (!fromOutside(e) || !actions) return;
      e.preventDefault();
      e.stopPropagation();
      endDrag();
      const sources = [...e.dataTransfer.files].map((f) => anur.pathOf(f)).filter(Boolean);
      if (sources.length === 0) return;
      void actions.importFiles(sources, into).then((made) => {
        if (made?.length) landed(into, made);
      });
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    endDrag();
    const moves = from.flatMap((f) => {
      const to = dropTarget(f, into);
      return to ? [{ from: f, to }] : [];
    });
    if (moves.length === 0 || !actions) return;
    void actions.move(moves).then((ok) => {
      if (ok)
        landed(
          into,
          moves.map((m) => m.to),
        );
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
      if (e.shiftKey && focused) {
        setMarked((m) => new Set([...(m.size ? m : [focused]), n.path]));
        setFocused(n.path);
        scrollPending.current = true;
        return;
      }
      setMarked(new Set());
      anchor.current = n.path;
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
    else if (e.key === "Backspace" && e.metaKey && node && editable) trash(pickedWith(node.path));
    else if (e.key === "Escape" && (marked.size > 0 || clip?.mode === "cut")) {
      setMarked(new Set());
      if (clip?.mode === "cut") setClip(null);
    } else if (e.key === "a" && e.metaKey) {
      setMarked(new Set(rows.map((n) => n.path)));
    } else return;
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
      marked.size > 1 && marked.has(n.path) ? "marked" : "",
      clip?.mode === "cut" && clip.paths.includes(n.path) ? "cut" : "",
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
          dragging.current = pickedWith(n.path);
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
          click(e, n);
        }}
        onAuxClick={(e) => {
          // A middle click opens a doc in a new tab, as in a browser.
          if (e.button === 1 && isDoc) openNode(n, true);
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

  /** ⌘-click picks a row too, ⇧-click a run of rows; a plain click opens it. */
  const click = (e: MouseEvent, n: TreeNode) => {
    if (e.metaKey || e.ctrlKey) {
      setMarked((m) => {
        const next = new Set(m.size ? m : focused ? [focused] : []);
        if (next.has(n.path)) next.delete(n.path);
        else next.add(n.path);
        return next;
      });
      anchor.current = n.path;
      setFocused(n.path);
      return;
    }
    if (e.shiftKey) {
      const rows = visible().map((r) => r.path);
      setMarked(new Set(rangeBetween(rows, anchor.current ?? focused ?? n.path, n.path)));
      setFocused(n.path);
      return;
    }
    setMarked(new Set());
    anchor.current = n.path;
    setFocused(n.path);
    if (n.kind === "folder") toggle(n.path);
    else openNode(n, false);
  };

  // ⌘C, ⌘X and ⌘V, from the keys or the Edit menu, while the tree has focus.
  const clipNow = useRef({ copyOut, paste, pickedWith, intoFor, focused, editing });
  clipNow.current = { copyOut, paste, pickedWith, intoFor, focused, editing };
  useEffect(() => {
    const on = (kind: "copy" | "cut" | "paste") => (e: ClipboardEvent) => {
      const now = clipNow.current;
      const el = document.activeElement;
      if (!list.current || !el || !list.current.contains(el) || el.tagName === "INPUT") return;
      if (now.editing) return;
      e.preventDefault();
      if (kind === "paste") void now.paste(now.intoFor(now.focused));
      else now.copyOut(now.pickedWith(now.focused), kind);
    };
    const copy = on("copy");
    const cut = on("cut");
    const pasteOn = on("paste");
    document.addEventListener("copy", copy);
    document.addEventListener("cut", cut);
    document.addEventListener("paste", pasteOn);
    return () => {
      document.removeEventListener("copy", copy);
      document.removeEventListener("cut", cut);
      document.removeEventListener("paste", pasteOn);
    };
  }, []);

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
