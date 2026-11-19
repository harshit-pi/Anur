import { useEffect, useRef, useState } from "react";
import { FOLDER_DOC, type SectionNode } from "@anur/core";
import type { Response } from "../../../shared/ipc-contract.ts";
import { anur } from "../bridge.ts";

/** What a new thread is about (Mock: Think scope and history, option A). */
export type Scope = "section" | "doc" | "folder";

export type ScopeChoice = {
  value: Scope;
  /** The opened folder's name, for "The whole folder" and the box's placeholder. */
  folderName: string;
  /** The open doc's name; null with no doc open, when only the folder can be picked. */
  docName: string | null;
  onChange: (scope: Scope) => void;
};

/** Think opens a scope from outside, as Recent does for a folder thread. */
export const SCOPE_EVENT = "anur:think-scope";

/** The chip in the box: what a new thread is about, and a menu of the three. */
export function ScopeChip({
  scope,
  section,
  disabled,
}: {
  scope: ScopeChoice;
  section: SectionNode;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!host.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  const heading = section.path.at(-1) ?? "This section";
  const label =
    scope.value === "folder"
      ? "The whole vault"
      : scope.value === "doc" || section.index === 0
        ? (scope.docName ?? "This doc")
        : heading;
  const items: { value: Scope; name: string; detail: string; off: boolean }[] = [
    {
      value: "section",
      name: "This section",
      detail: scope.docName && section.index > 0 ? heading : "",
      off: !scope.docName,
    },
    { value: "doc", name: "This doc", detail: scope.docName ?? "", off: !scope.docName },
    { value: "folder", name: "The whole vault", detail: scope.folderName, off: false },
  ];
  return (
    <span className="think-scope-pick" ref={host}>
      <button
        type="button"
        className={`think-scope-chip${open ? " open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="What a new thread is about"
        disabled={disabled}
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        <span className="truncate">{label}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
      {open ? (
        <span className="think-scope-menu" role="menu">
          {items.map((it) => (
            <button
              key={it.value}
              type="button"
              role="menuitemradio"
              aria-checked={scope.value === it.value}
              className={`think-scope-item${scope.value === it.value ? " on" : ""}`}
              disabled={it.off}
              onClick={() => {
                setOpen(false);
                scope.onChange(it.value);
              }}
            >
              <span>{it.name}</span>
              {it.detail ? <span className="think-scope-detail truncate">{it.detail}</span> : null}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}

type Recent = Response<"thread:recent">["threads"][number];

/** "4m", "2h", "Yesterday", "14 Nov", as a thread card says it. */
function ago(at: string): string {
  const ms = Date.now() - new Date(at).getTime();
  if (ms < 60_000) return "now";
  if (ms < 3_600_000) return `${String(Math.round(ms / 60_000))}m`;
  if (ms < 86_400_000) return `${String(Math.round(ms / 3_600_000))}h`;
  if (ms < 2 * 86_400_000) return "Yesterday";
  return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Where a recent thread lives, in a word or two. */
function whereOf(t: Recent): string {
  if (t.where.kind === "folder") return "Whole vault";
  const doc = (t.path.split("/").pop() ?? t.path).replace(/\.md$/i, "");
  return t.where.kind === "doc" ? doc : (t.where.path.at(-1) ?? doc);
}

/** Opens a thread wherever it lives: this doc, another doc, or the whole folder. */
export function openRecent(t: Recent, docPath: string | null) {
  const thread = () => {
    window.dispatchEvent(new CustomEvent("anur:open-thread", { detail: { thread: t.id } }));
  };
  if (t.path === docPath) {
    thread();
    return;
  }
  if (t.path === FOLDER_DOC) {
    window.dispatchEvent(new CustomEvent(SCOPE_EVENT, { detail: { scope: "folder" } }));
    window.setTimeout(thread, 150);
    return;
  }
  const heading = t.where.kind === "section" ? t.where.path.slice(1).join("#") : null;
  window.dispatchEvent(
    new CustomEvent("anur:open-path", { detail: { path: t.path, heading: heading || null } }),
  );
  window.setTimeout(thread, 500);
}

const SHOWN = 12;

/** Every thread in the folder, newest first, but the ones listed above it (Mock A's Recent). */
export function RecentThreads({
  hide,
  docPath,
}: {
  hide: ReadonlySet<string>;
  docPath: string | null;
}) {
  const [all, setAll] = useState<Recent[]>([]);
  const [more, setMore] = useState(false);
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      void anur.call("thread:recent", {}).then((r) => {
        if (current) setAll(r.threads);
      });
    };
    // A burst of thread events, as a reply streams, reloads once it settles.
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 800);
    };
    load();
    const off = anur.on("thread:event", (e) => {
      if (e.kind === "thread") soon();
    });
    window.addEventListener("anur:thread-deleted", soon);
    return () => {
      current = false;
      clearTimeout(timer);
      off();
      window.removeEventListener("anur:thread-deleted", soon);
    };
  }, [docPath]);
  const shown = all.filter((t) => !hide.has(t.id));
  if (shown.length === 0) return null;
  const list = more ? shown : shown.slice(0, SHOWN);
  return (
    <section className="think-recent" aria-label="Recent threads">
      <h3 className="think-subhead">Recent</h3>
      <ul className="think-threads">
        {list.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              className="think-thread"
              onClick={() => {
                openRecent(t, docPath);
              }}
            >
              <span className="think-thread-top">
                <span className="think-thread-title">{t.title}</span>
                <span className="think-thread-when">{ago(t.at)}</span>
              </span>
              <span className="think-thread-last">
                <span className="think-recent-where">{whereOf(t)}</span>
                {t.last ? ` · ${t.last}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {shown.length > SHOWN ? (
        <button
          type="button"
          className="think-more"
          onClick={() => {
            setMore((m) => !m);
          }}
        >
          {more ? "Show fewer" : `Show all ${String(shown.length)}`}
        </button>
      ) : null}
    </section>
  );
}
