import { useEffect, useRef, useState } from "react";

/**
 * 7. Command palette, ⌘K. Commands arrive with the groups that build them:
 * new doc, switch view, start a thread, Ask.
 */
const COMING = [
  { name: "New doc", hint: "⌘N" },
  { name: "Switch to Map", hint: "⌘M" },
  { name: "Start a thread on this section", hint: "" },
  { name: "Ask about this doc", hint: "whole-doc thread" },
];

export function CommandPalette({
  open,
  onClose,
  onNewDoc,
}: {
  open: boolean;
  onClose: () => void;
  /** Make a new doc (2.26); null when no writable folder is open. */
  onNewDoc: (() => void) | null;
}) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      input.current?.focus();
    }
  }, [open]);

  if (!open) return null;
  const shown = COMING.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()));
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
          placeholder="Type a command"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && onNewDoc && shown[0]?.name === "New doc") {
              onNewDoc();
              onClose();
            }
          }}
          aria-label="Command"
        />
        <ul className="palette-list">
          {shown.map((c) =>
            c.name === "New doc" && onNewDoc ? (
              <li key={c.name}>
                <button
                  type="button"
                  className="palette-item palette-action"
                  onClick={() => {
                    onNewDoc();
                    onClose();
                  }}
                >
                  <span>{c.name}</span>
                  <span className="quiet">{c.hint}</span>
                </button>
              </li>
            ) : (
              <li key={c.name} className="palette-item" aria-disabled="true">
                <span>{c.name}</span>
                <span className="quiet">{c.hint || "needs a doc"}</span>
              </li>
            ),
          )}
          {shown.length === 0 ? <li className="palette-item quiet">No command matches</li> : null}
        </ul>
        <p className="palette-note quiet">Commands work once a folder is open.</p>
      </div>
    </div>
  );
}
