/**
 * Think's box for writing to the agent: text, attachments and the queue of messages waiting their turn.
 */
import { useEffect, useRef, useState } from "react";
import { anur } from "../bridge.ts";
import { Icon, type Attachment, type Queued, FileCard } from "./think-parts.tsx";

export function Composer({
  placeholder,
  busy,
  disabled,
  onSend,
  onStop,
  sendLabel,
  pickers,
  attached = [],
  onAttach,
  onUnattach,
  inserted = null,
  chip = null,
  queue = [],
  onQueue,
  onUnqueue,
}: {
  /** Messages sent while the agent works, waiting their turn (as in Claude chat). */
  queue?: readonly Queued[];
  /** Given: Enter while busy queues the message instead of doing nothing. */
  onQueue?: (text: string) => void;
  onUnqueue?: (i: number) => void;
  /** What a new thread is about, as a chip above the box (Mock: Think scope). */
  chip?: React.ReactNode;
  placeholder: string;
  busy: boolean;
  disabled: boolean;
  onSend: (text: string) => Promise<boolean>;
  onStop?: () => void;
  sendLabel: string;
  /** Agent, mode and model, on the send button's line, as in the Claude app. */
  pickers?: React.ReactNode;
  attached?: readonly Attachment[];
  /** Files or folders to attach, by full path; none opens the picker. */
  onAttach?: (paths: string[] | null) => void;
  onUnattach?: (path: string) => void;
  /** Text to add where the cursor is, as a link dropped on the panel. */
  inserted?: { text: string; n: number } | null;
}) {
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!inserted) return;
    setText((t) => (t && !/\s$/.test(t) ? `${t} ${inserted.text}` : t + inserted.text));
    box.current?.focus();
  }, [inserted]);
  const canQueue = busy && Boolean(onQueue);
  const send = () => {
    const t = text.trim();
    if (!t || disabled) return;
    if (busy) {
      if (!onQueue) return;
      onQueue(t);
      setText("");
      return;
    }
    void onSend(t).then((ok) => {
      if (ok) setText("");
    });
  };
  const edit = (i: number) => {
    const q = queue[i];
    if (!q) return;
    onUnqueue?.(i);
    if (q.files.length) onAttach?.(q.files.map((f) => f.path));
    setText((t) => (t.trim() ? `${t.trimEnd()}\n\n${q.text}` : q.text));
    box.current?.focus();
  };
  const stop = () => {
    // Stopping takes back what's queued too: it returns to the box, unsent.
    for (let i = queue.length - 1; i >= 0; i--) edit(i);
    onStop?.();
  };
  return (
    <>
      {queue.length > 0 ? (
        <div className="think-queue" aria-label="Queued messages">
          {queue.map((q, i) => (
            <div className="think-queued" key={q.id}>
              <span className="think-queued-actions">
                <button
                  type="button"
                  aria-label="Edit"
                  title="Edit"
                  onClick={() => {
                    edit(i);
                  }}
                >
                  <Icon name="edit" />
                </button>
                <button
                  type="button"
                  aria-label="Remove"
                  title="Remove"
                  onClick={() => {
                    onUnqueue?.(i);
                  }}
                >
                  <Icon name="close" />
                </button>
              </span>
              {q.text}
              {q.files.length ? (
                <span className="think-queued-files">{q.files.map((f) => f.name).join(", ")}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <div className="think-composer">
        {chip ? <div className="think-scope-row">{chip}</div> : null}
        {attached.length > 0 ? (
          <ul className="think-attachments" aria-label="Attached">
            {attached.map((a) => (
              <li key={a.path}>
                <FileCard
                  path={a.path}
                  onRemove={() => {
                    onUnattach?.(a.path);
                  }}
                />
              </li>
            ))}
          </ul>
        ) : null}
        <textarea
          ref={box}
          onPaste={(e) => {
            // Files copied in Finder paste as attachments; text pastes as text.
            const files = [...e.clipboardData.files].map((f) => anur.pathOf(f)).filter(Boolean);
            if (files.length === 0 || !onAttach) return;
            e.preventDefault();
            onAttach(files);
          }}
          className="think-input"
          placeholder={placeholder}
          aria-label={placeholder}
          value={text}
          rows={2}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            // Grows with what's typed, up to a point, instead of a resize handle.
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${String(Math.min(el.scrollHeight, 220))}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="think-composer-foot">
          {onAttach ? (
            <button
              type="button"
              className="think-attach"
              aria-label="Attach files or folders"
              title="Attach files or folders (or drop them here)"
              disabled={disabled}
              onClick={() => {
                onAttach(null);
              }}
            >
              <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M13.5 7.5 8 13a3.5 3.5 0 0 1-5-5l6-6a2.3 2.3 0 0 1 3.3 3.3L6.4 11.2a1.2 1.2 0 0 1-1.7-1.7L10 4.2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ) : null}
          <div className="think-pickers">{pickers}</div>
          {busy && onStop && !(canQueue && text.trim()) ? (
            <button
              type="button"
              className="think-send think-stop"
              aria-label="Stop"
              title="Stop (Esc)"
              onClick={stop}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <rect x="1" y="1" width="10" height="10" rx="2" fill="currentColor" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              className={`think-send${text.trim() && !disabled ? " ready" : ""}`}
              aria-label={canQueue ? "Queue" : sendLabel}
              title={canQueue ? "Queue (Enter)" : `${sendLabel} (Enter)`}
              disabled={disabled || text.trim() === ""}
              onClick={send}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <path
                  d="M7 12V2M2.5 6.5 7 2l4.5 4.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>
      </div>
    </>
  );
}
