import { useEffect, useRef, useState } from "react";
import type { FolderState, Response } from "../../../shared/ipc-contract.ts";
import { anur } from "../bridge.ts";
import { docsNamed } from "../layout/new-doc.ts";
import { PlusIcon } from "./Icons.tsx";

/**
 * Search, in the left sidebar (task 2.26): docs by name first, then every
 * line that holds the words, read from the files on disk. Enter opens the
 * first result. New doc makes one beside the open doc, named as typed.
 */

type Found = Response<"folder:search">;

const name = (p: string) => (p.split("/").pop() ?? p).replace(/\.md$/i, "");
const dir = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

export function SearchPanel({
  folder,
  focus,
  onOpen,
  onOpenLine,
  onNewDoc,
}: {
  folder: FolderState;
  /** Changes whenever search is asked for, to put the cursor in the box. */
  focus: number;
  onOpen: (path: string, inNewTab: boolean) => void;
  onOpenLine: (path: string, line: number, column: number, length: number) => void;
  onNewDoc: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focus]);

  // Search as you type, a moment after the last key.
  useEffect(() => {
    if (query.trim() === "") {
      setFound(null);
      return;
    }
    let current = true;
    const t = setTimeout(() => {
      void anur.call("folder:search", { query }).then((r) => {
        if (current) setFound(r);
      });
    }, 200);
    return () => {
      current = false;
      clearTimeout(t);
    };
  }, [query, folder.path, folder.docs]);

  const named = docsNamed(folder.docs, query);
  const lines = found?.matches ?? [];
  const exact = folder.docs.some((d) => name(d).toLowerCase() === query.trim().toLowerCase());
  const writable = folder.mode === "writable";

  return (
    <div className="search-panel">
      <div className="search-box">
        <input
          ref={input}
          className="search-input"
          type="search"
          placeholder="Search docs"
          aria-label="Search docs"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const first = named[0];
              const line = lines[0];
              if (first) onOpen(first, e.metaKey || e.ctrlKey);
              else if (line) onOpenLine(line.path, line.line, line.column, query.trim().length);
            }
            if (e.key === "Escape") setQuery("");
          }}
        />
      </div>
      <button
        type="button"
        className="search-new"
        disabled={!writable}
        title={writable ? "New doc (⌘N)" : "This folder is read-only"}
        onClick={() => {
          onNewDoc(exact ? "" : query);
        }}
      >
        <PlusIcon />
        <span className="truncate">
          {query.trim() && !exact ? `New doc “${query.trim()}”` : "New doc"}
        </span>
      </button>
      {query.trim() === "" ? (
        <p className="quiet search-hint">Find docs by name, or any words in them.</p>
      ) : (
        <div className="search-results">
          {named.length > 0 ? (
            <section>
              <h3 className="search-heading">Docs</h3>
              {named.map((d) => (
                <button
                  key={d}
                  type="button"
                  className="search-result"
                  onClick={(e) => {
                    onOpen(d, e.metaKey || e.ctrlKey);
                  }}
                >
                  <span className="search-result-name truncate">{name(d)}</span>
                  {dir(d) ? <span className="search-result-where truncate">{dir(d)}</span> : null}
                </button>
              ))}
            </section>
          ) : null}
          {lines.length > 0 ? (
            <section>
              <h3 className="search-heading">In the text</h3>
              {lines.map((m) => (
                <button
                  key={`${m.path}:${String(m.line)}`}
                  type="button"
                  className="search-result"
                  onClick={() => {
                    onOpenLine(m.path, m.line, m.column, query.trim().length);
                  }}
                >
                  <span className="search-result-name truncate">{name(m.path)}</span>
                  <span className="search-result-line">{m.text}</span>
                </button>
              ))}
            </section>
          ) : null}
          {found && named.length === 0 && lines.length === 0 ? (
            <p className="quiet search-hint">Nothing in this folder matches.</p>
          ) : null}
          {found?.truncated ? (
            <p className="quiet search-hint">Showing the first {lines.length} lines.</p>
          ) : null}
          {found && found.skipped > 0 ? (
            <p className="quiet search-hint">
              {found.skipped} {found.skipped === 1 ? "doc is" : "docs are"} still in iCloud and
              weren't searched.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
