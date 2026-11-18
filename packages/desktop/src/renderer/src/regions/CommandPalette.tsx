import { useEffect, useRef, useState } from "react";
import type { FolderState, Response } from "../../../shared/ipc-contract.ts";
import { anur } from "../bridge.ts";
import { inlineRuns, splitMatches } from "../layout/inline-markdown.ts";
import { findDocs } from "../layout/find-docs.ts";

/**
 * 7. Command palette, from the magnifier or ⌘K. Typing searches the folder:
 * docs by name, then lines that hold the words (2.26), then commands. The
 * arrows move, Enter runs, ⌘Enter opens a doc in a new tab. Commands that
 * arrive with later groups are listed, dimmed.
 */

type Found = Response<"folder:search">;

type Item =
  | { kind: "doc"; path: string }
  | {
      kind: "line";
      path: string;
      line: number;
      column: number;
      text: string;
      length?: number | undefined;
    }
  | { kind: "command"; name: string; hint: string; run: (() => void) | null };

const name = (p: string) => (p.split("/").pop() ?? p).replace(/\.md$/i, "");
const dir = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

const keyOf = (it: Item) =>
  it.kind === "command" ? it.name : it.kind === "line" ? `${it.path}:${String(it.line)}` : it.path;

export function CommandPalette({
  open,
  onClose,
  folder,
  onOpen,
  onOpenLine,
  onNewDoc,
  onSwitchView,
  onThread,
  onAsk,
  onSystem,
  recent = [],
}: {
  open: boolean;
  onClose: () => void;
  folder: FolderState | null;
  onOpen: (path: string, inNewTab: boolean) => void;
  onOpenLine: (path: string, line: number, column: number, length: number) => void;
  /** Make a new doc named as given (2.26); null when no writable folder is open. */
  onNewDoc: ((name: string) => void) | null;
  /** Page to Map and back; null with no doc open. */
  onSwitchView: (() => void) | null;
  /** Think on the cursor's section, ready to type; null with no doc open. */
  onThread: (() => void) | null;
  /** Ask, the whole-doc thread (4.8); null with no doc open. */
  onAsk: (() => void) | null;
  /** Open the system tab, when the Engineering plugin is on. */
  onSystem: (() => void) | null;
  /** Docs opened lately, the latest first: they rank higher. */
  recent?: readonly string[];
}) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setFound(null);
      input.current?.focus();
    }
  }, [open]);

  // Search the text a moment after the last key.
  useEffect(() => {
    if (!open || !folder || query.trim() === "") {
      setFound(null);
      return;
    }
    let current = true;
    const t = setTimeout(() => {
      void anur.call("folder:search", { query }).then((r) => {
        if (current) setFound(r);
      });
    }, 150);
    return () => {
      current = false;
      clearTimeout(t);
    };
  }, [open, query, folder]);

  // A new query or new results: the first live item is active again.
  useEffect(() => {
    setActive(-1);
  }, [query, found]);

  useEffect(() => {
    list.current
      ?.querySelector(`[data-index="${String(active)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const q = query.trim();
  // No cap on either: the list scrolls.
  const docs = folder ? findDocs(folder.docs, q, recent) : [];
  const lines = found?.matches ?? [];
  const exact = folder?.docs.some((d) => name(d).toLowerCase() === q.toLowerCase()) ?? false;
  const commands: Item[] = [
    {
      kind: "command" as const,
      name: q && !exact ? `New doc “${q}”` : "New doc",
      hint: "⌘N",
      run: onNewDoc
        ? () => {
            onNewDoc(exact ? "" : q);
          }
        : null,
    },
    { kind: "command" as const, name: "Switch Page and Map", hint: "⇧⌘M", run: onSwitchView },
    { kind: "command" as const, name: "Start a thread on this section", hint: "", run: onThread },
    { kind: "command" as const, name: "Thread on the whole doc", hint: "", run: onAsk },
    ...(onSystem
      ? [{ kind: "command" as const, name: "Open the system map", hint: "", run: onSystem }]
      : []),
  ].filter(
    (c) =>
      q === "" || c.name.startsWith("New doc") || c.name.toLowerCase().includes(q.toLowerCase()),
  );
  const groups = [
    { title: "Docs", items: docs.map((path): Item => ({ kind: "doc", path })) },
    { title: "In the text", items: lines.map((m): Item => ({ kind: "line", ...m })) },
    { title: q ? "Commands" : null, items: commands },
  ].filter((g) => g.items.length > 0);
  const items = groups.flatMap((g) => g.items);
  const isLive = (it: Item | undefined) => !!it && (it.kind !== "command" || it.run !== null);
  const live = items.flatMap((it, i) => (isLive(it) ? [i] : []));
  const shown = isLive(items[active]) ? active : (live[0] ?? -1);

  const run = (it: Item | undefined, newTab: boolean) => {
    if (!it) return;
    if (it.kind === "doc") onOpen(it.path, newTab);
    else if (it.kind === "line") onOpenLine(it.path, it.line, it.column, it.length ?? q.length);
    else if (it.run) it.run();
    else return;
    onClose();
  };
  const move = (by: number) => {
    if (live.length === 0) return;
    const at = live.indexOf(shown);
    setActive(live[(at + by + live.length) % live.length] ?? -1);
  };

  let index = 0;
  return (
    <div
      className="palette-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={input}
          className="palette-input"
          placeholder={folder ? "Search docs, or type a command" : "Type a command"}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              move(1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              move(-1);
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(items[shown], e.metaKey || e.ctrlKey);
            }
          }}
          aria-label="Search docs, or type a command"
        />
        <ul className="palette-list" ref={list}>
          {groups.map((g) => (
            <li key={g.title ?? "commands"}>
              {g.title ? <div className="palette-heading">{g.title}</div> : null}
              <ul className="palette-group">
                {g.items.map((it) => {
                  const i = index++;
                  if (!isLive(it) && it.kind === "command") {
                    return (
                      <li key={keyOf(it)} className="palette-item" aria-disabled="true">
                        <span>{it.name}</span>
                        <span className="quiet">{it.hint || "needs a doc"}</span>
                      </li>
                    );
                  }
                  const on = i === shown;
                  return (
                    <li key={keyOf(it)}>
                      <button
                        type="button"
                        data-index={i}
                        className={`palette-item palette-action${on ? " active" : ""}`}
                        onMouseMove={() => {
                          if (!on) setActive(i);
                        }}
                        onClick={(e) => {
                          run(it, e.metaKey || e.ctrlKey);
                        }}
                      >
                        {it.kind === "doc" ? (
                          <>
                            <span className="truncate">
                              <Matched text={name(it.path)} query={q} />
                            </span>
                            <span className="quiet truncate">{dir(it.path)}</span>
                          </>
                        ) : it.kind === "line" ? (
                          <>
                            <LineText text={it.text} query={q} />
                            <span className="quiet truncate">{name(it.path)}</span>
                          </>
                        ) : (
                          <>
                            <span className="truncate">{it.name}</span>
                            <span className="quiet">{it.hint}</span>
                          </>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
          {q && found && docs.length === 0 && lines.length === 0 ? (
            <li className="palette-item quiet">No doc or line in this folder matches</li>
          ) : null}
          {q && found && found.skipped > 0 ? (
            <li className="palette-item quiet">
              {found.skipped === 1
                ? "1 doc is still in iCloud, so its text wasn't searched."
                : `${String(found.skipped)} docs are still in iCloud, so their text wasn't searched.`}
            </li>
          ) : null}
        </ul>
        <p className="palette-note quiet">
          {folder
            ? "↑ and ↓ to move, Enter to open, ⌘Enter to open in a new tab"
            : "Search and commands work once a folder is open."}
        </p>
      </div>
    </div>
  );
}

/** The query's matches in `text`, marked. */
function Matched({ text, query }: { text: string; query: string }) {
  return (
    <>
      {splitMatches(text, query).map((p, i) => (p.match ? <mark key={i}>{p.text}</mark> : p.text))}
    </>
  );
}

/** A found line as the page shows it: its Markdown styled, its marks hidden. */
function LineText({ text, query }: { text: string; query: string }) {
  return (
    <span className="palette-line truncate">
      {inlineRuns(text).map((r, i) => {
        const inner = <Matched text={r.text} query={query} />;
        return r.marks.length > 0 ? (
          <span key={i} className={r.marks.map((m) => `md-${m}`).join(" ")}>
            {inner}
          </span>
        ) : (
          <span key={i}>{inner}</span>
        );
      })}
    </span>
  );
}
