import { ServiceIcon, serviceOf } from "../icons/services/index.tsx";
import { editsLand } from "../../../shared/edits-land.ts";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { choicePress } from "../layout/map-acts.ts";
import { FOLDER_DOC, diffLines, type SectionNode, type SectionTree } from "@anur/core";
import { RecentThreads, ScopeChip, type ScopeChoice } from "./ThinkScope.tsx";
import type {
  AgentSignIn,
  SessionOption,
  AgentStatus,
  EventPayload,
  ThreadItem,
  ThreadView,
  PreviewView,
} from "../../../shared/ipc-contract.ts";
import { AGENTS, type AgentId } from "../../../shared/agents.ts";
import { anur } from "../bridge.ts";
import { listOf, stepOf } from "./step-label.ts";
import { AGENT_SHORT, AgentMark } from "./AgentMark.tsx";
import { useFeatures } from "../features.ts";
import { formatTokens } from "../layout/tokens.ts";
import { SectionEditor } from "../editor/section-editor.tsx";
import { putOption, renameSection } from "../editor/section-range.ts";
import type { EditorView } from "@codemirror/view";
import { inlineRuns } from "../layout/inline-markdown.ts";

/**
 * The Think panel (task 3.5): the section the cursor is in, its text as it
 * stands, and its threads. Each thread is its own chat with the person's
 * agent, started from this section. What the agent reads isn't listed:
 * it was more than a thread needs on screen.
 */

type Prompt = EventPayload<"thread:event"> & { kind: "permission" };

const countOf = (n: number, noun: string) => `${String(n)} ${noun}${n === 1 ? "" : "s"}`;

/** The last open-thread request acted on: Think remounts with the tab, and a request opens once. */
let handledRequest = 0;

const samePath = (a: readonly string[] | null, b: readonly string[]) =>
  a !== null && a.length === b.length && a.every((x, i) => x === b[i]);

/** The doc's threads, kept current from main's events. */
function useThreads(docPath: string | null, docText: () => string) {
  const [threads, setThreads] = useState<ThreadView[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  /** The doc whose list has come back; until then the panel says it's loading, not that there are none. */
  const [listed, setListed] = useState<string | null>(null);
  const textNow = useRef(docText);
  textNow.current = docText;

  const [loads, setLoads] = useState(0);
  const shownDoc = useRef<string | null>(null);
  /** Read the list again, after threads moved or went (group 11). */
  const reload = useCallback(() => {
    setLoads((n) => n + 1);
  }, []);
  useEffect(() => {
    if (shownDoc.current !== docPath) {
      shownDoc.current = docPath;
      setThreads([]);
      setPrompts([]);
    }
    if (!docPath) return;
    let current = true;
    void anur.call("thread:list", { path: docPath, text: textNow.current() }).then((r) => {
      if (!current) return;
      setThreads(r.threads);
      setListed(docPath);
    });
    const off = anur.on("thread:event", (e) => {
      if (e.kind === "thread") {
        if (e.path !== docPath) return;
        setThreads((ts) => [...ts.filter((t) => t.id !== e.thread.id), e.thread]);
        if (!e.thread.busy) setPrompts((ps) => ps.filter((p) => p.thread !== e.thread.id));
        return;
      }
      if (e.kind === "permission") {
        setPrompts((ps) => [...ps, e]);
        return;
      }
      setThreads((ts) =>
        ts.map((t) => (t.id === e.thread ? { ...t, busy: true, items: withEvent(t.items, e) } : t)),
      );
    });
    return () => {
      current = false;
      off();
    };
  }, [docPath, loads]);

  return { threads, setThreads, prompts, setPrompts, reload, loading: listed !== docPath };
}

/** A reply arriving piece by piece, or a tool call changing state. */
function withEvent(
  items: ThreadItem[],
  e: Exclude<EventPayload<"thread:event">, { kind: "thread" | "permission" }>,
): ThreadItem[] {
  if (e.kind === "text") {
    const last = items.at(-1);
    if (last?.kind === "message" && last.role === "agent" && last.turn === e.turn)
      return [...items.slice(0, -1), { ...last, text: last.text + e.text }];
    return [...items, { kind: "message", turn: e.turn, role: "agent", text: e.text }];
  }
  const at = items.findIndex((i) => i.kind === "tool" && i.toolUse === e.toolUse);
  const tool: ThreadItem = {
    kind: "tool",
    turn: e.turn,
    toolUse: e.toolUse,
    title: e.title,
    status: e.status,
  };
  return at < 0 ? [...items, tool] : items.map((i, n) => (n === at ? tool : i));
}

/** A section's own text, without its heading line. */
export function bodyOf(text: string, s: SectionNode): string {
  const from = s.headingRange ? s.headingRange.to : s.ownRange.from;
  return text.slice(from, s.ownRange.to).trim();
}

/** A table row's cells; `\\|`, as in a wiki link's alias, stays in its cell. */
function cellsOf(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));
}
const DELIMITER = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/**
 * Splits a block around its first table: the lines before it, the table's
 * rows, and the lines after. A table is a row of cells, a `---` delimiter
 * row, then rows until a line that isn't one.
 */
function splitTable(lines: string[]) {
  const at = lines.findIndex(
    (l, i) => l.includes("|") && DELIMITER.test(lines[i + 1] ?? "") && lines[i + 1]?.includes("-"),
  );
  if (at < 0) return null;
  let end = at + 2;
  while (end < lines.length && (lines[end] ?? "").includes("|")) end++;
  return { before: lines.slice(0, at), rows: lines.slice(at, end), after: lines.slice(end) };
}

/** Light Markdown for a reply: paragraphs, bullets, tables and inline styles. */
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s/;

/**
 * A block split where its kind changes, as Markdown reads it: a heading is
 * its own block, and a list right after a line of text starts a new one.
 */
function byKind(block: string): string[] {
  const out: string[][] = [];
  let kind: "heading" | "list" | "text" | "quote" | null = null;
  for (const line of block.split("\n")) {
    const next: "heading" | "list" | "text" | "quote" = /^\s*>/.test(line)
      ? "quote"
      : /^#{1,6}\s/.test(line)
        ? "heading"
        : BULLET.test(line) || (kind === "list" && /^\s+\S/.test(line))
          ? "list"
          : "text";
    if (next !== kind || next === "heading") out.push([]);
    out.at(-1)?.push(line);
    kind = next;
  }
  return out.map((l) => l.join("\n"));
}

/** A callout's colour, as Obsidian groups its types. */
function calloutTone(type: string): string {
  const t = type.toLowerCase();
  if (["tip", "hint", "important", "success", "check", "done"].includes(t)) return "green";
  if (["warning", "caution", "attention", "question", "help", "faq"].includes(t)) return "amber";
  if (["failure", "fail", "missing", "danger", "error", "bug"].includes(t)) return "red";
  if (["quote", "cite", "example"].includes(t)) return "grey";
  return "blue";
}

/**
 * A quote block: Obsidian's callout when its first line is "[!type] Title",
 * drawn with its title as on the page; otherwise a plain quote.
 */
function Quote({ block }: { block: string }) {
  const lines = block.split("\n").map((l) => l.replace(/^\s*>\s?/, ""));
  const head = /^\[!([\w-]+)\][+-]?\s*(.*)$/.exec(lines[0] ?? "");
  if (!head) {
    return (
      <blockquote className="md-quote">
        <Markdown text={lines.join("\n")} />
      </blockquote>
    );
  }
  const type = head[1] ?? "note";
  const label = type.charAt(0).toUpperCase() + type.slice(1);
  const title = head[2]?.trim() ?? "";
  const rest = lines.slice(1).join("\n").trim();
  // As the page draws it: the type, then the title, formatted.
  return (
    <div className={`md-callout ${calloutTone(type)}`}>
      <div className="md-callout-title">
        <span className="md-callout-type">{label}</span>
        {title
          ? inlineRuns(title).map((r, j) => (
              <span key={j} className={r.marks.map((m) => `md-${m}`).join(" ") || undefined}>
                {r.text}
              </span>
            ))
          : null}
      </div>
      {rest ? <Markdown text={rest} /> : null}
    </div>
  );
}

export function Markdown({ text }: { text: string }) {
  // A table's blank-line-free rows stay one block; anything around it is its own block.
  const blocks = text.split(/\n{2,}/).flatMap((block) => {
    const out: string[] = [];
    let rest = block.split("\n");
    for (let t = splitTable(rest); t; t = splitTable(rest)) {
      if (t.before.length) out.push(t.before.join("\n"));
      out.push(t.rows.join("\n"));
      rest = t.after;
    }
    if (rest.length) out.push(rest.join("\n"));
    return out.flatMap((part) => (splitTable(part.split("\n")) ? [part] : byKind(part)));
  });
  return (
    <>
      {blocks.map((block, b) => {
        const lines = block.split("\n");
        if (/^\s*>/.test(lines[0] ?? "")) return <Quote key={b} block={block} />;
        const bullets = BULLET.test(lines[0] ?? "");
        const render = (line: string, i: number) => (
          <span key={i}>
            {inlineRuns(line).map((r, j) => (
              <span key={j} className={r.marks.map((m) => `md-${m}`).join(" ") || undefined}>
                {r.text}
              </span>
            ))}
          </span>
        );
        const table = splitTable(lines);
        if (table && table.before.length === 0) {
          const [head = "", delimiter = "", ...rows] = table.rows;
          const align = cellsOf(delimiter).map((c) =>
            c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : undefined,
          );
          return (
            <div key={b} className="think-table-wrap">
              <table className="think-table">
                <thead>
                  <tr>
                    {cellsOf(head).map((c, i) => (
                      <th key={i} style={{ textAlign: align[i] }}>
                        {render(c, i)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, j) => (
                    <tr key={j}>
                      {cellsOf(r).map((c, i) => (
                        <td key={i} style={{ textAlign: align[i] }}>
                          {render(c, i)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (bullets)
          return (
            <ul key={b} className="think-list">
              {lines
                .reduce<string[]>((items, l) => {
                  // An indented line under an item continues it.
                  if (BULLET.test(l) || items.length === 0) items.push(l);
                  else if (l.trim()) items.push(`${items.pop() ?? ""} ${l.trim()}`);
                  return items;
                }, [])
                .map((l, i) => (
                  <li key={i}>{render(l, i)}</li>
                ))}
            </ul>
          );
        if (/^#{1,6}\s/.test(block))
          return (
            <p key={b} className="think-heading">
              {render(block, 0)}
            </p>
          );
        return (
          <p key={b}>
            {lines.map((l, i) => (
              <span key={i}>
                {i > 0 ? <br /> : null}
                {render(l, i)}
              </span>
            ))}
          </p>
        );
      })}
    </>
  );
}

/** Past this share of the window grown since the first turn, a thread offers Start fresh (4.9). */
const START_FRESH_AT = 0.4;

/**
 * How big the thread has grown (4.9), from the agent's own usage reports:
 * the tokens it has used, and how full its context is. Past 40% of the
 * window above the first turn, it offers to start fresh.
 */
function SizeMeter({
  tokens,
  onStartFresh,
}: {
  tokens: { context: number; first: number; window: number | null };
  onStartFresh: () => void;
}) {
  // Shown only when the thread has grown long; its size otherwise is the ring by the pickers.
  const grown = tokens.window ? (tokens.context - tokens.first) / tokens.window : 0;
  if (grown <= START_FRESH_AT) return null;
  return (
    <p className="think-meter-note">
      This thread has grown long, and an agent reasons less well late in a long context.{" "}
      <button type="button" className="think-more" onClick={onStartFresh}>
        Start fresh
      </button>{" "}
      from the section's text.
    </p>
  );
}

/** How full the thread's context is, as a ring beside the pickers, as in Claude's apps. */
function ContextRing({ tokens }: { tokens: { context: number; window: number | null } }) {
  if (!tokens.window) return null;
  const share = Math.min(1, tokens.context / tokens.window);
  const r = 6;
  const around = 2 * Math.PI * r;
  const label = `${String(Math.round(share * 100))}% context: ${formatTokens(tokens.context)} of ${formatTokens(tokens.window)}`;
  return (
    <span className="think-ring" title={label} aria-label={label} role="img">
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <circle className="think-ring-track" cx="8" cy="8" r={r} />
        <circle
          className="think-ring-fill"
          cx="8"
          cy="8"
          r={r}
          strokeDasharray={`${String(around * Math.max(share, 0.02))} ${String(around)}`}
          transform="rotate(-90 8 8)"
        />
      </svg>
    </span>
  );
}

/** The text of a proposed edit, without its section's own heading line. */
function proposedBody(part: { proposed: string }): string {
  return part.proposed.replace(/^#{1,6}[ \t].*\n?/, "").trim();
}

/**
 * An edit a thread made to a section, shown like an option: what the section
 * would say, and Use this. The page shows the same edit in place.
 */
/**
 * A choice card's text, cut short with a fade. It opens when clicked, never on hover:
 * hovering used to open it and push Use, Add as subsection and Explore this down from
 * under the pointer, so the first click missed (30.30).
 */
function OfferText({
  children,
  open,
  onToggle,
}: {
  children: React.ReactNode;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={`think-offer-text${open ? " open" : ""}`}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      title={open ? "Show less" : "Show all"}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      {children}
    </div>
  );
}

function EditCard({
  part,
  writable,
  onUse,
  onShow,
  onDrop,
}: {
  part: { path: string[]; proposed: string };
  writable: boolean;
  onUse: () => void;
  onShow: () => void;
  onDrop: () => void;
}) {
  const body = proposedBody(part);
  const [textOpen, setTextOpen] = useState(false);
  return (
    <div
      className="think-offer edit"
      role="group"
      aria-label={`Proposed edit to ${part.path.at(-1) ?? ""}`}
    >
      <div className="think-offer-head">
        <strong>± Edit {part.path.at(-1)}</strong>
        <span className="quiet">Not in the doc yet</span>
      </div>
      <OfferText
        open={textOpen}
        onToggle={() => {
          setTextOpen((v) => !v);
        }}
      >
        {body ? <Markdown text={body} /> : <p className="quiet">Removes the section's text.</p>}
      </OfferText>
      <div className="think-offer-actions">
        {writable ? (
          <button type="button" className="think-button primary" onClick={onUse}>
            Use
          </button>
        ) : null}
        <button type="button" className="think-more" onClick={onShow}>
          Show on page
        </button>
        {writable ? (
          <button type="button" className="think-more" onClick={onDrop}>
            Set aside
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Rows dragged from the files panel carry their full paths under this type (see FileTree). */
const PANEL_PATHS = "application/x-anur-files";

/** A file or folder waiting in the composer, sent with the next message (10.4). */
export type Attachment = { path: string; name: string };

function Composer({
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

/** Under a person's message, on hover, as in Claude chat: when, and Copy. */
function MineActions({ text, at }: { text: string; at: string | null }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="think-mine-actions">
      {at ? (
        <time dateTime={at} title={new Date(at).toLocaleString()}>
          {sentWhen(at)}
        </time>
      ) : null}
      <button
        type="button"
        aria-label={copied ? "Copied" : "Copy"}
        title={copied ? "Copied" : "Copy"}
        onClick={() => {
          void anur.call("clipboard:write", { text }).then(() => {
            setCopied(true);
            setTimeout(() => {
              setCopied(false);
            }, 1500);
          });
        }}
      >
        <Icon name={copied ? "copied" : "copy"} />
      </button>
    </div>
  );
}

/** "Just now", "5 min ago", then the time today, else the date. */
function sentWhen(at: string): string {
  const d = new Date(at);
  const ms = Date.now() - d.getTime();
  if (ms < 60_000) return "Just now";
  if (ms < 3_600_000) return `${String(Math.round(ms / 60_000))} min ago`;
  if (d.toDateString() === new Date().toDateString())
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** A message waiting for the agent to finish, with the files attached when it was queued. */
export type Queued = { id: number; text: string; files: Attachment[] };

/** The icons under a reply and on a queued message. */
function Icon({ name }: { name: "copy" | "copied" | "branch" | "use" | "edit" | "close" }) {
  const d = {
    copy: "M10.5 5V3.6A1.6 1.6 0 0 0 8.9 2H3.6A1.6 1.6 0 0 0 2 3.6v5.3A1.6 1.6 0 0 0 3.6 10.5H5M6.6 5h5.3A1.6 1.6 0 0 1 13.5 6.6v5.3a1.6 1.6 0 0 1-1.6 1.6H6.6A1.6 1.6 0 0 1 5 11.9V6.6A1.6 1.6 0 0 1 6.6 5Z",
    copied: "M3 8.5 6.5 12 13 4.5",
    branch:
      "M4.5 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm0 0v6m0 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm7-4a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm0 0c0 2.5-2 3-5.5 4.2",
    use: "M9.5 2H4.2A1.2 1.2 0 0 0 3 3.2v9.6A1.2 1.2 0 0 0 4.2 14h7.6a1.2 1.2 0 0 0 1.2-1.2V5.5L9.5 2ZM8 7v4.5M5.8 9.3 8 11.5l2.2-2.2",
    edit: "M10.8 2.7a1.6 1.6 0 0 1 2.3 2.3L6 12.1 3 13l.9-3 6.9-7.3Z",
    close: "M4 4l8 8M12 4l-8 8",
  }[name];
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Think({
  docPath,
  docText,
  tree,
  section,
  writable,
  request,
  onJump,
  page,
  noun = "section",
  extra = null,
  scope = null,
}: {
  /**
   * What a new thread is about: this section, this doc or the whole folder,
   * shown as a chip in the box; with it, the list ends in Recent, every
   * thread in the folder. The system map's Think has none.
   */
  scope?: ScopeChoice | null;
  /** The page's own view: the section's text is edited here through it. */
  page: () => EditorView | null;
  /** What a section is called here: a doc's section, or a repo or part on the system map (29.1). */
  noun?: string;
  /** More of this section's context, under Context and history, such as a box's calls (29.8). */
  extra?: React.ReactNode;
  docPath: string | null;
  docText: () => string;
  tree: SectionTree | null;
  section: SectionNode | null;
  writable: boolean;
  /** A thread to open now, as "Keep discussing" on a preview asks. */
  request: { thread: string; n: number } | null;
  /** Scroll the page to a section, by its index in the tree. */
  onJump: (index: number) => void;
}) {
  const features = useFeatures();
  // An option picked on the map: its card in the open thread comes into view,
  // marked for a moment, so Use this is one click away.
  useEffect(() => {
    const onOption = (e: Event) => {
      const { option, action } = (e as CustomEvent<{ option?: string; action?: string }>).detail;
      const selector = option
        ? `.think-offer[data-option="${CSS.escape(option)}"]`
        : action
          ? `.think-proposed-action[data-action="${CSS.escape(action)}"]`
          : null;
      if (!selector) return;
      // The thread may still be drawing when the map asks: look again a few
      // times before giving up.
      let tries = 0;
      const find = () => {
        const card = document.querySelector<HTMLElement>(selector);
        if (!card) {
          if (++tries < 12) window.setTimeout(find, 150);
          return;
        }
        card.scrollIntoView({ block: "center", behavior: "smooth" });
        card.classList.add("flash");
        window.setTimeout(() => {
          card.classList.remove("flash");
        }, 1600);
      };
      find();
    };
    window.addEventListener("anur:show-option", onOption);
    return () => {
      window.removeEventListener("anur:show-option", onOption);
    };
  }, []);
  const { threads, setThreads, prompts, setPrompts, reload, loading } = useThreads(
    docPath,
    docText,
  );
  /** Closed threads on this section, shown on a click (11.3). */
  const [showClosed, setShowClosed] = useState(false);
  const [openOffers, setOpenOffers] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  // A thread deleted from the map: gone from the list, and closed if it was open here.
  useEffect(() => {
    const onDeleted = (e: Event) => {
      const { thread } = (e as CustomEvent<{ thread: string }>).detail;
      setThreads((ts) => ts.filter((t) => t.id !== thread));
      setOpen((o) => (o === thread ? null : o));
    };
    window.addEventListener("anur:thread-deleted", onDeleted);
    return () => {
      window.removeEventListener("anur:thread-deleted", onDeleted);
    };
  }, [setThreads]);
  /** Each agent's connection, as main last reported it. */
  const [statuses, setStatuses] = useState<Partial<Record<AgentId, AgentStatus>>>({});
  const noteStatus = useCallback((s: AgentStatus) => {
    setStatuses((all) => ({ ...all, [s.id]: s }));
  }, []);
  /** The agent a new thread runs on: the default from settings, unless picked here. */
  const [newAgent, setNewAgent] = useState<AgentId>("claude-code");
  /** The agents switched on in Settings → Agents; null until read. */
  const [agentsOn, setAgentsOn] = useState<AgentId[] | null>(null);
  /** A new thread's mode and model: the agent's choices, as last seen, with the person's picks. */
  const [newChoices, setNewChoices] = useState<SessionOption[]>([]);
  /** The mode a Build started now runs in, named on its button: it acts as that mode does. */
  const buildMode = (() => {
    const mode = newChoices.find((o) => o.choices.some((c) => c.value === "plan"));
    return mode?.choices.find((c) => c.value === mode.current)?.name ?? null;
  })();
  /** Each agent's sign-in, as main last reported it (3.16). */
  const [signIns, setSignIns] = useState<Partial<Record<AgentId, AgentSignIn>>>({});
  useEffect(
    () =>
      anur.on("agent:auth", (e) => {
        setSignIns((all) => ({ ...all, [e.agent]: e }));
      }),
    [],
  );
  /** Read an agent's sign-in when Think shows a thread, or a new one, on it. */
  const checkSignIn = useCallback((agent: AgentId) => {
    if (!AGENTS[agent].runsThreads) return;
    void anur.call("agent:auth", { agent }).then((e) => {
      setSignIns((all) => ({
        ...all,
        [agent]: all[agent]?.auth.state === "unknown" || !all[agent] ? e : all[agent],
      }));
    });
  }, []);
  /** The sign-in view, in place of the message box, while the agent isn't signed in. */
  const signedOut = (agent: AgentId) => {
    const e = signIns[agent];
    return e?.auth.state === "unauthenticated" ? <SignInCard e={e} /> : null;
  };
  useEffect(() => {
    let current = true;
    setNewChoices([]);
    void anur.call("agent:options", { agent: newAgent }).then((r) => {
      if (current) setNewChoices(r.options);
    });
    // Read again in the background: the first time, or with newer choices.
    const off = anur.on("agent:options", (e) => {
      if (e.agent === newAgent) setNewChoices((now) => withPicks(e.options, now));
    });
    return () => {
      current = false;
      off();
    };
  }, [newAgent]);
  const [error, setError] = useState<string | null>(null);
  /** Earlier Use alls are folded to one link until it is pressed. */
  const [showEarlier, setShowEarlier] = useState(false);
  /** Branch (10.5): the next thread started here continues that thread up to that item. */
  const [branch, setBranch] = useState<{
    thread: string;
    upTo: number;
    title: string;
    excerpt: string;
  } | null>(null);
  /** Files and folders waiting in the composer, sent with the next message (10.4). */
  const [attached, setAttached] = useState<Attachment[]>([]);
  /** Each thread's messages sent while it worked, sent in order once it's done. */
  const [queued, setQueued] = useState<Record<string, Queued[]>>({});
  const queuedN = useRef(0);
  const sendingQueued = useRef(new Set<string>());
  /** A link dropped on the panel goes into the message, as text. */
  const [inserted, setInserted] = useState<{ text: string; n: number } | null>(null);
  const attach = useCallback((paths: string[] | null) => {
    const add = (list: string[]) => {
      setAttached((a) => [
        ...a,
        ...list
          .filter((p) => !a.some((x) => x.path === p))
          .map((p) => ({ path: p, name: p.split("/").pop() ?? p })),
      ]);
    };
    if (paths) add(paths);
    else
      void anur.call("inputs:pick-files", {}).then(({ files }) => {
        add(files);
      });
  }, []);
  /** A reply sent to a thread: shown at once, the thread marked working; false if refused. */
  const sendReply = async (id: string, message: string, files: readonly Attachment[]) => {
    setError(null);
    if (!docPath) return false;
    const r = await anur.call("thread:send", {
      thread: id,
      path: docPath,
      text: docText(),
      message,
      ...(files.length ? { files: files.map((a) => a.path) } : {}),
    });
    if (r.kind === "refused") {
      setError(r.reason);
      return false;
    }
    setThreads((ts) =>
      ts.map((t) =>
        t.id === id
          ? {
              ...t,
              busy: true,
              items: [
                ...t.items,
                {
                  kind: "message",
                  turn: "",
                  role: "person",
                  text: message,
                  at: new Date().toISOString(),
                },
              ],
            }
          : t,
      ),
    );
    return true;
  };
  // A thread that's done sends the next message queued while it worked.
  useEffect(() => {
    for (const t of threads) {
      const next = queued[t.id]?.[0];
      if (!next || t.busy || sendingQueued.current.has(t.id)) continue;
      sendingQueued.current.add(t.id);
      setQueued((q) => ({ ...q, [t.id]: (q[t.id] ?? []).slice(1) }));
      void sendReply(t.id, next.text, next.files).finally(() => {
        sendingQueued.current.delete(t.id);
      });
    }
  }, [threads, queued]);
  const composerAttach = {
    attached,
    inserted,
    onAttach: attach,
    onUnattach: (p: string) => {
      setAttached((a) => a.filter((x) => x.path !== p));
    },
  };
  /** Files or links held over the panel, to add as inputs. */
  const [dropOver, setDropOver] = useState(false);
  const [showText, setShowText] = useState(false);
  /** The edits threads proposed on this doc: each a card, like an option. */
  const [previews, setPreviews] = useState<PreviewView[]>([]);
  const textNow = useRef(docText);
  textNow.current = docText;

  useEffect(() => {
    setPreviews([]);
    if (!docPath) return;
    let current = true;
    const load = () => {
      void anur.call("preview:list", { path: docPath, text: textNow.current() }).then((r) => {
        if (current) setPreviews(r.previews);
      });
    };
    load();
    const off = anur.on("preview:changed", ({ path }) => {
      if (path === docPath) load();
    });
    return () => {
      current = false;
      off();
    };
  }, [docPath]);

  useEffect(() => {
    void anur.call("agent:status", { connect: false }).then(noteStatus);
    return anur.on("agent:status", noteStatus);
  }, [noteStatus]);
  // The agents on, and the default among them: read again whenever one is switched.
  useEffect(() => {
    const read = () => {
      void Promise.all([anur.call("agents:list", {}), anur.call("settings:get", {})]).then(
        ([a, s]) => {
          const on = a.agents.filter((r) => r.on).map((r) => r.id);
          setAgentsOn(on);
          setNewAgent(on.includes(s.defaultAgent) ? s.defaultAgent : (on[0] ?? s.defaultAgent));
        },
      );
    };
    read();
    window.addEventListener("anur:settings-changed", read);
    const off = anur.on("agents:changed", read);
    return () => {
      window.removeEventListener("anur:settings-changed", read);
      off();
    };
  }, []);

  // A section's threads: those on it, and those whose choices or planned
  // actions the map draws under it, so the panel never says "no threads"
  // beside a box with choices hanging off it.
  const onSection = useMemo(() => {
    if (!section) return [];
    const name = section.path.at(-1)?.trim().toLowerCase();
    const under = (t: ThreadView) =>
      t.path !== null &&
      section.path.length > t.path.length &&
      samePath(section.path.slice(0, t.path.length), t.path);
    return threads.filter(
      (t) =>
        samePath(t.path, section.path) ||
        t.items.some(
          (it) =>
            (it.kind === "proposed-action" &&
              it.path !== null &&
              samePath(it.path, section.path)) ||
            (it.kind === "options" &&
              !it.several &&
              !t.explores &&
              it.heading?.trim().toLowerCase() === name &&
              under(t)),
        ),
    );
  }, [threads, section]);
  const here = useMemo(() => onSection.filter((t) => !t.closed), [onSection]);
  const closedHere = useMemo(() => onSection.filter((t) => t.closed), [onSection]);
  /** Every other thread in the doc, in the order of their sections, the latest first within one. */
  const elsewhere = useMemo(() => {
    const order = new Map(tree?.sections.map((s, i) => [s.path.join("\u0000"), i]));
    const at = (t: ThreadView) => (t.path ? (order.get(t.path.join("\u0000")) ?? 1e9) : 1e9);
    // Closed threads stay with their section; a gone section's are under Orphaned.
    return threads
      .filter((t) => !onSection.includes(t) && !t.closed && t.path !== null)
      .sort((a, b) => at(a) - at(b));
  }, [threads, onSection, tree]);
  /**
   * What a thread needs from the person: an answer to its agent, options to
   * pick, or an edit to use; else running, or done.
   */
  const stateOf = useCallback(
    (t: ThreadView): ThreadState => {
      if (t.busy) return "running";
      const offers = t.items.flatMap((x) => (x.kind === "options" ? [x] : []));
      const unpicked = offers.length > 0 && !offers.some((x) => x.used);
      const proposed = previews.some((p) => p.thread === t.id && p.parts.length > 0);
      const asking = prompts.some((p) => p.thread === t.id);
      return unpicked || proposed || asking ? "needs-you" : "done";
    },
    [previews, prompts],
  );
  /** A new thread, shown the moment it's sent, while Anur gets it ready. */
  const [starting, setStarting] = useState<ThreadView | null>(null);
  /** A branch not sent yet: the chat up to the reply it came from, saved on the first send. */
  const [draft, setDraft] = useState<ThreadView | null>(null);
  const thread =
    threads.find((t) => t.id === open) ??
    (starting && starting.id === open ? starting : null) ??
    (draft && draft.id === open ? draft : null);
  const isDraft = thread !== null && thread === draft;
  // While a reply streams, the panel keeps its end in view, unless the person scrolled up.
  const chatRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useEffect(() => {
    following.current = true;
    const scroller = chatRef.current?.closest<HTMLElement>(".right-main");
    if (!scroller) return;
    const onScroll = () => {
      following.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [open]);
  useEffect(() => {
    if (!thread?.busy || !following.current) return;
    const scroller = chatRef.current?.closest<HTMLElement>(".right-main");
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [thread]);
  // A branch opens ready to type in.
  const draftId = draft?.id ?? null;
  useEffect(() => {
    if (draftId && open === draftId)
      document.querySelector<HTMLTextAreaElement>(".think .think-input")?.focus();
  }, [open, draftId]);
  // Leaving a draft unsent leaves nothing behind.
  useEffect(() => {
    if (draft && open !== draft.id) {
      setDraft(null);
      setBranch(null);
    }
  }, [open, draft]);
  const shownAgent = thread?.agent ?? newAgent;
  useEffect(() => {
    checkSignIn(shownAgent);
  }, [shownAgent, checkSignIn]);

  // "Keep discussing" on a preview: open that thread, wherever the cursor is.
  useEffect(() => {
    if (!request || request.n <= handledRequest) return;
    handledRequest = request.n;
    setOpen(request.thread);
  }, [request]);

  // Moving the cursor to another section shows its threads, unless the open
  // thread is still running. Opening a thread from elsewhere doesn't close it.
  const sectionKey = section?.path.join("\u0000") ?? null;
  /** What new threads on this section receive from earlier ones (4.4). */
  /** Findings kept on this section and above it (16.1). */
  const [findings, setFindings] = useState<
    {
      id: string;
      thread: string;
      claim: string;
      source: string | null;
      section: string;
      by?: "source" | "person" | undefined;
      quote?: string | null | undefined;
      who?: string | null | undefined;
      instead?: string | null | undefined;
      until?: string | null | undefined;
      at?: string | undefined;
      lapsed?: "until" | "gone" | null | undefined;
      home?: string | undefined;
      disputed?:
        | {
            id: string;
            claim: string;
            who: string | null;
            thread: string;
            home?: string | undefined;
          }
        | null
        | undefined;
    }[]
  >([]);
  const [inputs, setInputs] = useState<
    { id: string; thread: string; source: string; label: string; trust: string; local: boolean }[]
  >([]);
  /** Where this section's links go, and what links to it (8.3). */
  const [links, setLinks] = useState<{
    out: { doc: string | null; heading: string | null; written: string }[];
    into: { doc: string; path: string[] }[];
  }>({ out: [], into: [] });
  useEffect(() => {
    setLinks({ out: [], into: [] });
    if (!docPath || !section) return;
    let current = true;
    const t = window.setTimeout(() => {
      void anur
        .call("links:of", {
          path: docPath,
          text: docText(),
          section: { index: section.index, path: section.path },
        })
        .then((r) => {
          if (current) setLinks(r);
        });
    }, 150);
    return () => {
      current = false;
      window.clearTimeout(t);
    };
    // Again as the section's text changes, so a link just typed shows.
  }, [docPath, sectionKey, section?.ownRange.to, section?.ownRange.from]);
  const threadsSeen = threads.map((t) => `${t.id}:${String(t.items.length)}`).join(",");
  useEffect(() => {
    if (docPath && section)
      void anur
        .call("findings:list", {
          path: docPath,
          text: docText(),
          section: { index: section.index, path: section.path },
        })
        .then((r) => {
          setFindings(r.findings);
        });
    else setFindings([]);
    setInputs([]);
    if (!docPath || !section) return;
    let current = true;
    void anur
      .call("inputs:list", {
        path: docPath,
        text: docText(),
        section: { index: section.index, path: section.path },
      })
      .then((r) => {
        if (current) setInputs(r.inputs);
      });
    return () => {
      current = false;
    };
    // Again when the section changes or a thread's turn adds lines.
  }, [docPath, sectionKey, threadsSeen]);
  const lastSection = useRef(sectionKey);
  useEffect(() => {
    if (lastSection.current === sectionKey) return;
    lastSection.current = sectionKey;
    // Close the thread that was open, but never one opened in the same moment, as when a
    // click on the map picks a box on another section and opens its thread together.
    if (thread && section && !samePath(thread.path, section.path) && !thread.busy) {
      const was = thread.id;
      setOpen((o) => (o === was ? null : o));
    }
  }, [sectionKey, section, thread]);

  const start = useCallback(
    async (
      message: string,
      purpose?: "build" | "check",
      from?: ThreadView,
      /** Build or Check pressed on a section's box on the map (30.32), when it isn't the one shown. */
      on?: { index: number; path: string[] },
    ) => {
      const at = on ?? section;
      if (!docPath || !at) return false;
      setError(null);
      // An action runs in the mode the person picked, as any thread does:
      // Anur adds no approval Claude Code wouldn't ask for.
      const choices = from?.options ?? newChoices;
      const agent = from?.agent ?? newAgent;
      const options = choices.map((o) => ({ id: o.id, value: o.current }));
      const shown =
        purpose === "build"
          ? `Build this ${noun}`
          : purpose === "check"
            ? `Check this ${noun}`
            : message;
      const placeholder: ThreadView = {
        id: `starting:${String(Date.now())}`,
        branchedFrom: from?.branchedFrom ?? null,
        section: "",
        path: at.path,
        title: shown.split("\n")[0]?.slice(0, 80) ?? "",
        closed: false,
        busy: true,
        busySince: Date.now(),
        reads: [],
        items: [
          ...(purpose ? [] : attached).map((a) => ({
            kind: "attached" as const,
            source: "attachment",
            label: a.name,
          })),
          { kind: "message" as const, turn: "", role: "person" as const, text: shown },
        ],
        options: choices,
        tokens: null,
        purpose: purpose ?? null,
        agent,
      };
      setStarting(placeholder);
      setOpen(placeholder.id);
      const r = await anur.call("thread:start", {
        path: docPath,
        text: docText(),
        section: { index: at.index, path: at.path },
        message,
        agent,
        options,
        ...(purpose ? { purpose } : {}),
        ...(branch && !purpose ? { branch: { thread: branch.thread, upTo: branch.upTo } } : {}),
        ...(attached.length && !purpose ? { files: attached.map((a) => a.path) } : {}),
      });
      setStarting(null);
      if (r.kind === "refused") {
        setOpen((o) => (o === placeholder.id ? null : o));
        setError(r.reason);
        return false;
      }
      setBranch(null);
      setDraft(null);
      if (!purpose) setAttached([]);
      setThreads((ts) => [...ts.filter((t) => t.id !== r.thread.id), r.thread]);
      setOpen(r.thread.id);
      return true;
    },
    [docPath, section, docText, setThreads, newAgent, newChoices, branch, attached],
  );

  /**
   * ▶ Run on an action a thread proposed (Mock 10): a Build on its section,
   * with what the proposal said to do, in the mode picked for new threads.
   */
  const runAction = useCallback(
    async (from: ThreadView, a: { id: string; what: string; path: readonly string[] | null }) => {
      const target = a.path ?? from.path;
      const node = tree?.sections.find((x) => target && samePath(target, x.path));
      if (!docPath || !node) {
        setError("That action's section is gone.");
        return;
      }
      setError(null);
      const r = await anur.call("thread:start", {
        path: docPath,
        text: docText(),
        section: { index: node.index, path: node.path },
        message: a.what,
        agent: newAgent,
        options: newChoices.map((o) => ({ id: o.id, value: o.current })),
        purpose: "build",
        fromAction: { thread: from.id, action: a.id },
      });
      if (r.kind === "refused") {
        setError(r.reason);
        return;
      }
      setThreads((ts) => [...ts.filter((t) => t.id !== r.thread.id), r.thread]);
      setOpen(r.thread.id);
    },
    [tree, docPath, docText, newAgent, newChoices, setThreads],
  );
  // Build or Check pressed on a section's box on the map (30.32): the same as the links here.
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ index: number; path: string[]; purpose: "build" | "check" }>)
        .detail;
      const node = tree?.sections[d.index];
      if (!node || !samePath(node.path, d.path)) return;
      void start("-", d.purpose, undefined, { index: node.index, path: node.path });
    };
    window.addEventListener("anur:map-section-action", on);
    return () => {
      window.removeEventListener("anur:map-section-action", on);
    };
  }, [tree, start]);

  // ▶ Run pressed on a planned box on the map.
  useEffect(() => {
    const onRun = (e: Event) => {
      const { thread, action } = (e as CustomEvent<{ thread: string; action: string }>).detail;
      const from = threads.find((t) => t.id === thread);
      const a = from?.items.find((x) => x.kind === "proposed-action" && x.id === action);
      if (from && a?.kind === "proposed-action" && !a.run) void runAction(from, a);
    };
    window.addEventListener("anur:run-action", onRun);
    return () => {
      window.removeEventListener("anur:run-action", onRun);
    };
  }, [threads, runAction]);

  /** Dropping files, rows from the files panel, or links on Think adds them as inputs. */
  const dropProps = () =>
    writable
      ? {
          onDragOver: (e: React.DragEvent) => {
            const t = e.dataTransfer.types;
            if (!t.includes("Files") && !t.includes(PANEL_PATHS) && !t.includes("text/uri-list"))
              return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setDropOver(true);
          },
          onDragLeave: (e: React.DragEvent) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropOver(false);
          },
          onDrop: (e: React.DragEvent) => {
            setDropOver(false);
            const dt = e.dataTransfer;
            let files = [...dt.files].map((f) => anur.pathOf(f)).filter(Boolean);
            if (files.length === 0 && dt.types.includes(PANEL_PATHS)) {
              try {
                const listed: unknown = JSON.parse(dt.getData(PANEL_PATHS));
                if (Array.isArray(listed))
                  files = listed.filter((p): p is string => typeof p === "string");
              } catch {
                // Not a list of paths.
              }
            }
            const links =
              files.length > 0
                ? []
                : dt
                    .getData("text/uri-list")
                    .split(/\r?\n/)
                    .map((l) => l.trim())
                    .filter((l) => /^https?:\/\//i.test(l));
            if (files.length === 0 && links.length === 0) return;
            e.preventDefault();
            // Files and folders wait in the composer; a link goes into the message as text.
            if (files.length) attach(files);
            else setInserted((x) => ({ text: links.join(" "), n: (x?.n ?? 0) + 1 }));
          },
        }
      : {};

  /** A picked option goes into the page, where ⌘Z takes it back; the thread remembers the pick. */
  const useOption = (
    t: ThreadView,
    option: { id: string; title: string; text: string },
    how: "replace" | "subsection" | "also",
    heading: string | null = null,
    /** For "also": the option already picked, which moves into its own subsection. */
    picked: { title: string } | null = null,
  ) => {
    const main = page();
    const section = tree?.sections.find((x) => t.path && samePath(t.path, x.path));
    if (!main || !docPath || !section) {
      setError("This thread's section is gone, so the option has nowhere to go.");
      return;
    }
    // A decision with its own name goes under a subsection of that name:
    // into the one already there, nearest first at any depth, else a new one.
    let node = section;
    let put = option;
    // "Also": beside the option already picked, as its own subsection.
    let mode: "replace" | "subsection" | "beside" = how === "also" ? "beside" : how;
    if (heading) {
      const name = heading.trim().toLowerCase();
      const own = tree?.sections
        .filter(
          (x) =>
            x.path.length > section.path.length &&
            samePath(x.path.slice(0, section.path.length), section.path) &&
            x.path.at(-1)?.trim().toLowerCase() === name,
        )
        .sort((a, b) => a.path.length - b.path.length)[0];
      if (own) {
        node = own;
        mode = how === "also" ? "beside" : "replace";
      } else {
        put = { ...option, title: heading };
        mode = "subsection";
      }
    }
    if (!putOption(main, docPath.split("/").pop() ?? docPath, node, put, mode, picked)) {
      setError("This thread's section is gone, so the option has nowhere to go.");
      return;
    }
    void anur.call("thread:use-option", {
      thread: t.id,
      path: docPath,
      text: main.state.doc.toString(),
      option: option.id,
      how: how === "also" ? "also" : mode === "beside" ? "subsection" : mode,
    });
  };

  /** Skip a proposed part, or undo that: the thread remembers, the doc is untouched. */
  const skipOption = (t: ThreadView, option: string, skip: boolean) => {
    if (!docPath) return;
    void anur.call("thread:skip-option", {
      thread: t.id,
      path: docPath,
      text: docText(),
      option,
      skip,
    });
  };

  /** Explore this: its own thread, clean of the other options (30.18). */
  const exploreOption = (t: ThreadView, option: string) => {
    if (!docPath) return;
    setError(null);
    void anur
      .call("thread:explore-option", { thread: t.id, path: docPath, text: docText(), option })
      .then((r) => {
        if (r.kind === "refused") {
          setError(r.reason);
          return;
        }
        setThreads((ts) => [...ts.filter((x) => x.id !== r.thread.id), r.thread]);
        setOpen(r.thread.id);
      });
  };

  /**
   * Use or Explore pressed on a choice on the map (30.32): the same as its
   * card's buttons here, so the doc and the thread can't tell them apart.
   */
  const onMapChoice = useRef<
    (d: { thread: string; option: string; act: "use" | "explore" | "skip" }) => void
  >(() => undefined);
  onMapChoice.current = ({ thread: id, option, act }) => {
    const t = threads.find((x) => x.id === id);
    const item = t?.items.find(
      (x): x is Extract<ThreadView["items"][number], { kind: "options" }> =>
        x.kind === "options" && x.options.some((o) => o.id === option),
    );
    const o = item?.options.find((x) => x.id === option);
    if (!t || !item || !o) return;
    const press = choicePress(item, o.id, act);
    if (press?.kind === "explore") exploreOption(t, o.id);
    else if (press?.kind === "skip") skipOption(t, o.id, true);
    else if (press) useOption(t, o, press.how, press.heading);
  };
  useEffect(() => {
    const on = (e: Event) => {
      onMapChoice.current(
        (e as CustomEvent<{ thread: string; option: string; act: "use" | "explore" | "skip" }>)
          .detail,
      );
    };
    window.addEventListener("anur:map-choice", on);
    return () => {
      window.removeEventListener("anur:map-choice", on);
    };
  }, []);

  /** "Use in doc": a reply's text added at the end of its thread's section, ⌘Z to undo. */
  const addToSection = (t: ThreadView, text: string) => {
    const main = page();
    const node = tree?.sections.find((x) => t.path && samePath(t.path, x.path));
    if (!main || !node) {
      setError("This thread's section is gone, so the reply has nowhere to go.");
      return;
    }
    const at = node.ownRange.to;
    const before = main.state.doc.sliceString(Math.max(0, at - 2), at);
    const lead = before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    main.dispatch({
      changes: { from: at, insert: `${lead}${text.trim()}\n` },
      userEvent: "input.use-reply",
    });
    main.focus();
  };

  if (!docPath || !tree)
    return <p className="quiet">Threads on the section you're in show here.</p>;
  if (!section) return <p className="quiet">Put the cursor in a section to think about it.</p>;

  /** Why the agent can't run threads now, with Try again; nothing when it can. */
  const notConnected = (id: AgentId) => {
    const s = statuses[id];
    if (!AGENTS[id].runsThreads)
      return (
        <div className="think-banner" role="status">
          <p>{AGENTS[id].why}</p>
        </div>
      );
    if (s?.connected !== false) return null;
    return (
      <div className="think-banner" role="status">
        <p>{s.reason ?? "The agent isn't connected."}</p>
        <button
          type="button"
          className="think-button"
          onClick={() => {
            void anur.call("agent:status", { connect: true, agent: id }).then(noteStatus);
          }}
        >
          Try again
        </button>
      </div>
    );
  };

  if (thread) {
    const asks = prompts.filter((p) => p.thread === thread.id);
    // Who answered heads each reply: above its first step or its text, once per turn.
    const folded = foldSteps(thread.items, thread.busy);
    /** Every Use all but the latest folds to one link, so the thread isn't a column of them. */
    const earlierUsedAll = thread.items
      .flatMap((x, n) => (x.kind === "used-all" ? [n] : []))
      .slice(0, -1);
    // A branch shows the chat it carries from its parent first, as in Claude chat.
    const carried = (t: ThreadView, seen: Set<string>): ThreadItem[] => {
      const from = t.branchedFrom;
      const parent = from ? threads.find((x) => x.id === from.thread) : undefined;
      if (!from || from.upTo === undefined || !parent || seen.has(parent.id)) return [];
      return [
        ...carried(parent, new Set([...seen, parent.id])),
        ...parent.items.slice(0, from.upTo + 1),
      ];
    };
    const inherited = carried(thread, new Set([thread.id])).flatMap((x) =>
      x.kind === "message" ? [x] : [],
    );
    const whoBefore = new Set<number>();
    let afterPerson = true;
    for (const { item, i } of folded) {
      const mine = item.kind === "message" && item.role === "person";
      const theirs = item.kind === "tool" || (item.kind === "message" && item.role === "agent");
      if (theirs && afterPerson) whoBefore.add(i);
      if (mine) afterPerson = true;
      else if (theirs) afterPerson = false;
    }
    return (
      <div className={`think${dropOver ? " think-drop" : ""}`} {...dropProps()}>
        <div className="think-head">
          <button
            type="button"
            className="think-back"
            aria-label="All threads"
            title="All threads"
            onClick={() => {
              setOpen(null);
            }}
          >
            ←
          </button>
          <div className="think-head-main">
            <h2
              className="think-title"
              // Click to rename: the name shows here, in the list and on the map.
              contentEditable={writable && !isDraft ? "plaintext-only" : false}
              suppressContentEditableWarning
              spellCheck={false}
              title={writable ? "Click to rename" : undefined}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
                if (e.key === "Escape") {
                  e.currentTarget.textContent = thread.title;
                  e.currentTarget.blur();
                }
              }}
              onBlur={(e) => {
                const name = e.currentTarget.textContent.replace(/\s+/g, " ").trim();
                if (!name || !docPath) {
                  e.currentTarget.textContent = thread.title;
                  return;
                }
                if (name === thread.title) return;
                setThreads((ts) => ts.map((t) => (t.id === thread.id ? { ...t, title: name } : t)));
                void anur.call("thread:rename", {
                  thread: thread.id,
                  path: docPath,
                  text: docText(),
                  title: name,
                });
              }}
            >
              {thread.title}
            </h2>
            {thread.path ? (
              <button
                type="button"
                className="think-where"
                title="Show this section on the page"
                onClick={() => {
                  const i = tree.sections.findIndex((x) => samePath(thread.path, x.path));
                  if (i >= 0) onJump(i);
                }}
              >
                {docPath === FOLDER_DOC ? "on the whole space" : `on ${thread.path.at(-1) ?? ""}`}
              </button>
            ) : (
              <span className="think-where quiet">its section is gone</span>
            )}
            {thread.explores ? (
              <span className="think-where quiet think-branch-path">
                {exploresPath(thread, threads).join(" › ")}
              </span>
            ) : null}
            {thread.by ? (
              <span className="think-where quiet think-started-by">
                started by {thread.by}
                {thread.startedAt
                  ? ` on ${new Date(thread.startedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`
                  : ""}
              </span>
            ) : null}
          </div>
          {writable && docPath && !isDraft ? (
            <span className="think-top-actions">
              <button
                type="button"
                className={thread.closed ? "think-more" : "think-icon"}
                aria-label={thread.closed ? "Reopen" : "Close thread"}
                title={
                  thread.closed
                    ? "Show it with this section's threads again"
                    : "Close: hide it from this section's threads; nothing is deleted"
                }
                disabled={thread.busy}
                onClick={() => {
                  const closed = !thread.closed;
                  setThreads((ts) => ts.map((t) => (t.id === thread.id ? { ...t, closed } : t)));
                  void anur.call("thread:close", {
                    thread: thread.id,
                    path: docPath,
                    text: docText(),
                    closed,
                  });
                  if (closed) setOpen(null);
                }}
              >
                {thread.closed ? (
                  "Reopen"
                ) : (
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                    <path
                      d="M4 4l8 8M12 4l-8 8"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                )}
              </button>
              <button
                type="button"
                className="think-icon danger"
                aria-label="Delete thread"
                title="Delete thread"
                disabled={thread.busy}
                onClick={() => {
                  if (
                    !window.confirm(
                      `Delete “${thread.title}”? Its chat and the edits it proposes go at once. This can't be undone.`,
                    )
                  )
                    return;
                  void anur.call("thread:delete", { thread: thread.id }).then((r) => {
                    if (r.kind === "refused") {
                      setError(r.reason);
                      return;
                    }
                    setOpen(null);
                    setThreads((ts) => ts.filter((t) => t.id !== thread.id));
                    // The map draws threads too: it drops this one.
                    window.dispatchEvent(
                      new CustomEvent("anur:thread-deleted", { detail: { thread: thread.id } }),
                    );
                    reload();
                  });
                }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M7 7v4M9 7v4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </span>
          ) : null}
        </div>
        {thread.tokens ? (
          <SizeMeter
            tokens={thread.tokens}
            onStartFresh={() => {
              // A new thread on the thread's own section, from its text and inputs only.
              const i = tree.sections.findIndex(
                (x) => thread.path && samePath(thread.path, x.path),
              );
              if (i >= 0) onJump(i);
              setOpen(null);
              requestAnimationFrame(() => {
                document.querySelector<HTMLTextAreaElement>(".think .think-input")?.focus();
              });
            }}
          />
        ) : null}
        <div className="think-chat" aria-live="polite" ref={chatRef}>
          {inherited.map((m, n) =>
            m.role === "agent" ? (
              <Fragment key={`from${String(n)}`}>
                {inherited[n - 1]?.role !== "agent" ? (
                  <div className="think-who" title={whoLabel(thread.agent, thread.options)}>
                    <AgentMark agent={thread.agent} />
                  </div>
                ) : null}
                <AgentReply text={m.text} who={null} onBranch={null} onUse={null} />
              </Fragment>
            ) : (
              <div key={`from${String(n)}`} className="think-message-wrap person">
                <div className="think-message person">{m.text}</div>
                <MineActions text={m.text} at={m.at ?? null} />
              </div>
            ),
          )}
          {folded.map(({ item, i, steps, leads }) => (
            <Fragment key={`e${String(i)}`}>
              {whoBefore.has(i) ? (
                <div className="think-who" title={whoLabel(thread.agent, thread.options)}>
                  <AgentMark agent={thread.agent} />
                </div>
              ) : null}
              {steps ? (
                <StepsFold
                  key={`steps-${String(i)}`}
                  steps={steps}
                  running={thread.busy && i + steps.length === thread.items.length}
                />
              ) : item.kind === "message" ? (
                item.role === "agent" ? (
                  <AgentReply
                    key={i}
                    text={item.text}
                    who={null}
                    onBranch={
                      writable && !thread.busy && !isDraft
                        ? () => {
                            setBranch({
                              thread: thread.id,
                              upTo: i,
                              title: thread.title,
                              excerpt: item.text.replace(/\s+/g, " ").slice(0, 60),
                            });
                            const at = tree.sections.findIndex(
                              (x) => thread.path && samePath(thread.path, x.path),
                            );
                            if (at >= 0) onJump(at);
                            // Straight into the child, as in Claude chat: saved on its first send.
                            const child: ThreadView = {
                              ...thread,
                              id: `draft:${thread.id}:${String(i)}`,
                              items: [],
                              branchedFrom: { thread: thread.id, title: thread.title, upTo: i },
                              busy: false,
                              closed: false,
                              reads: [],
                              tokens: null,
                              purpose: null,
                            };
                            setDraft(child);
                            setOpen(child.id);
                          }
                        : null
                    }
                    onUse={
                      writable && !thread.busy && thread.path && !isDraft
                        ? () => {
                            addToSection(thread, item.text);
                          }
                        : null
                    }
                    after={
                      leads ? <p className="think-from-answer quiet">From this answer</p> : null
                    }
                  />
                ) : (
                  <div key={i} className="think-message-wrap person">
                    {item.by ? <div className="think-by">{item.by}</div> : null}
                    <div className="think-message person">{item.text}</div>
                    <MineActions text={item.text} at={item.at ?? null} />
                  </div>
                )
              ) : item.kind === "tool" ? (
                <div key={i} className={`think-step ${item.status}`} title={item.title}>
                  <span className="think-step-mark" aria-hidden="true">
                    {item.status === "failed" ? "×" : item.status === "completed" ? "✓" : "●"}
                  </span>
                  {serviceOf(item.title) ? <ServiceIcon service={serviceOf(item.title)} /> : null}
                  {toolLabel(item.title)}
                  {item.status === "completed" || item.status === "failed" ? "" : "…"}
                </div>
              ) : item.kind === "options" ? (
                <div key={i} className="think-offers" role="group" aria-label="Options">
                  {item.several ? (
                    <p className="think-offers-within quiet">
                      Parts that can all belong: add any of them, each as its own section
                      {writable && item.added.length < item.options.length ? (
                        <>
                          {" · "}
                          <button
                            type="button"
                            className="think-more"
                            onClick={() => {
                              for (const o of item.options)
                                if (!item.added.includes(o.id) && !item.skipped.includes(o.id))
                                  useOption(thread, o, "subsection");
                            }}
                          >
                            Add all
                          </button>
                        </>
                      ) : null}
                    </p>
                  ) : item.heading ? (
                    <p className="think-offers-within quiet">
                      For <strong>{item.heading}</strong>, under this section
                    </p>
                  ) : null}
                  {item.within ? (
                    <p className="think-offers-within quiet">
                      Within{" "}
                      {thread.items
                        .flatMap((x) => (x.kind === "options" ? x.options : []))
                        .find((o) => o.id === item.within)?.title ?? "an earlier option"}
                    </p>
                  ) : null}
                  {item.options.map((o) =>
                    // A part skipped: one quiet line, with Undo.
                    item.several && item.skipped.includes(o.id) && !item.added.includes(o.id) ? (
                      <p key={o.id} data-option={o.id} className="think-offer-skipped quiet">
                        Skipped “{o.title}”
                        {writable ? (
                          <>
                            {" · "}
                            <button
                              type="button"
                              className="think-more"
                              onClick={() => {
                                skipOption(thread, o.id, false);
                              }}
                            >
                              Undo
                            </button>
                          </>
                        ) : null}
                      </p>
                    ) : (
                      <div
                        key={o.id}
                        data-option={o.id}
                        className={`think-offer${item.used === o.id || item.added.includes(o.id) ? " used" : item.explored.includes(o.id) ? " explored" : ""}`}
                      >
                        <div className="think-offer-head">
                          <strong>{o.title}</strong>
                          {item.used === o.id || item.added.includes(o.id) ? (
                            <span className="quiet">In the doc</span>
                          ) : item.explored.includes(o.id) ? (
                            <span className="quiet">Explored</span>
                          ) : null}
                        </div>
                        <OfferText
                          open={openOffers.has(o.id)}
                          onToggle={() => {
                            setOpenOffers((cur) => {
                              const next = new Set(cur);
                              if (!next.delete(o.id)) next.add(o.id);
                              return next;
                            });
                          }}
                        >
                          <Markdown text={o.text} />
                        </OfferText>
                        {writable && item.several && !item.added.includes(o.id) ? (
                          <div className="think-offer-actions">
                            <button
                              type="button"
                              className="think-button primary"
                              onClick={() => {
                                useOption(thread, o, "subsection");
                              }}
                            >
                              Add
                            </button>
                            <button
                              type="button"
                              className="think-button"
                              onClick={() => {
                                skipOption(thread, o.id, true);
                              }}
                            >
                              Skip
                            </button>
                          </div>
                        ) : writable &&
                          !item.several &&
                          item.used !== o.id &&
                          !item.added.includes(o.id) ? (
                          <div className="think-offer-actions">
                            <button
                              type="button"
                              className="think-button primary"
                              onClick={() => {
                                useOption(thread, o, "replace", item.heading);
                              }}
                            >
                              {item.used ? "Use instead" : "Use"}
                            </button>
                            {item.used ? (
                              <button
                                type="button"
                                className="think-more"
                                title="Keep the option already picked and add this one beside it"
                                onClick={() => {
                                  useOption(
                                    thread,
                                    o,
                                    "also",
                                    item.heading,
                                    item.options.find((x) => x.id === item.used) ?? null,
                                  );
                                }}
                              >
                                Also add
                              </button>
                            ) : null}
                            {item.heading || item.used ? null : (
                              <button
                                type="button"
                                className="think-more"
                                onClick={() => {
                                  useOption(thread, o, "subsection");
                                }}
                              >
                                Add as subsection
                              </button>
                            )}
                            {item.explored.includes(o.id) ? null : (
                              <button
                                type="button"
                                className="think-more"
                                onClick={() => {
                                  exploreOption(thread, o.id);
                                }}
                              >
                                Explore this
                              </button>
                            )}
                          </div>
                        ) : null}
                      </div>
                    ),
                  )}
                </div>
              ) : item.kind === "auto-used" ? (
                <div key={i} className="think-changed auto" role="status">
                  <span>
                    {item.undone ? "Taken back: " : "Used as it landed: "}
                    the edit to{" "}
                    <strong>{item.sections.map((p) => p.at(-1) ?? "").join(", ")}</strong>
                    {item.doc !== docPath ? ` in ${item.doc}` : ""}.
                    {!item.undone && !item.undoable && item.doc === docPath
                      ? " ⌘Z on the page takes it back."
                      : ""}
                  </span>
                  {item.undoable ? (
                    <button
                      type="button"
                      className="think-button"
                      onClick={() => {
                        void anur
                          .call("thread:auto-undo", { thread: thread.id, id: item.id })
                          .then((r) => {
                            if (r.kind === "refused") setError(r.reason);
                          });
                      }}
                    >
                      Undo
                    </button>
                  ) : null}
                </div>
              ) : item.kind === "check" ? (
                <CheckCard
                  key={i}
                  claims={item.claims}
                  corrected={item.corrected}
                  onKeep={
                    writable
                      ? (claim, source) => {
                          void anur.call("finding:decide", {
                            thread: thread.id,
                            add: { claim, source },
                          });
                        }
                      : null
                  }
                />
              ) : item.kind === "finding" ? (
                <FindingCard key={i} item={item} thread={thread.id} writable={writable} />
              ) : item.kind === "used-all" && earlierUsedAll.includes(i) && !showEarlier ? (
                i === earlierUsedAll[0] ? (
                  <button
                    key={i}
                    type="button"
                    className="think-link think-earlier"
                    onClick={() => {
                      setShowEarlier(true);
                    }}
                  >
                    {`${String(earlierUsedAll.length)} earlier Use all${earlierUsedAll.length === 1 ? "" : "s"}`}
                  </button>
                ) : null
              ) : item.kind === "used-all" ? (
                <div key={i} className="think-changed auto compact" role="status">
                  <span
                    title={item.docs
                      .map(
                        (d) =>
                          `${d.doc.replace(/\.md$/i, "")}: ${d.sections.map((p) => p.at(-1) ?? "").join(", ")}`,
                      )
                      .join("\n")}
                  >
                    {item.undone ? "Taken back: " : "Used "}
                    {countOf(
                      item.docs.reduce((n, d) => n + d.sections.length, 0),
                      "edit",
                    )}{" "}
                    in {item.docs.map((d) => d.doc.replace(/\.md$/i, "")).join(", ")}
                    {item.kept.length > 0 ? (
                      <span className="quiet" title={item.kept.join("\n")}>
                        {` · ${String(item.kept.length)} kept as proposal${item.kept.length === 1 ? "" : "s"}`}
                      </span>
                    ) : null}
                  </span>
                  {item.undoable ? (
                    <button
                      type="button"
                      className="think-button"
                      onClick={() => {
                        void anur
                          .call("thread:undo-all", {
                            thread: thread.id,
                            id: item.id,
                            open: docPath ? { path: docPath, text: docText() } : null,
                          })
                          .then((r) => {
                            if (r.kind === "refused") setError(r.reason);
                            else if (r.left.length > 0)
                              setError(
                                `Couldn't take back ${r.left.join(", ")}: it changed where the edits did. Use its History.`,
                              );
                          });
                      }}
                    >
                      Undo
                    </button>
                  ) : null}
                </div>
              ) : item.kind === "proposed" ? (
                <div key={i} className="think-changed auto" role="status">
                  <span>
                    Proposed an edit to{" "}
                    <strong>{item.sections.map((p) => p.at(-1) ?? "").join(", ")}</strong> in{" "}
                    {item.doc}, shown on its page.
                  </span>
                  <button
                    type="button"
                    className="think-button"
                    onClick={() => {
                      window.dispatchEvent(
                        new CustomEvent("anur:open-path", { detail: { path: item.doc } }),
                      );
                    }}
                  >
                    Open
                  </button>
                </div>
              ) : item.kind === "created" ? (
                <div key={i} className="think-changed auto" role="status">
                  <span>
                    {item.undone ? "Made, then taken back: " : "Made "}
                    <button
                      type="button"
                      className="think-link"
                      onClick={() => {
                        window.dispatchEvent(
                          new CustomEvent("anur:open-path", { detail: { path: item.doc } }),
                        );
                      }}
                    >
                      {item.doc}
                    </button>
                  </span>
                  {item.undoable ? (
                    <button
                      type="button"
                      className="think-button"
                      onClick={() => {
                        void anur
                          .call("thread:undo-created", { thread: thread.id, id: item.id })
                          .then((r) => {
                            if (r.kind === "refused") setError(r.reason);
                          });
                      }}
                    >
                      Undo
                    </button>
                  ) : null}
                </div>
              ) : item.kind === "attached" ? (
                <div key={i} className="think-sent-attachment">
                  <FileCard
                    path={item.label}
                    onOpen={() => {
                      openFile(item.label);
                    }}
                  />
                </div>
              ) : item.kind === "proposed-action" ? (
                <div
                  key={i}
                  className="think-proposed-action"
                  data-action={item.id}
                  role="group"
                  aria-label="Proposed action"
                >
                  <div className="think-offer-head">
                    <strong>
                      <span className="map-pill-icon">{item.run ? "✓" : "▶"}</span> {item.title}
                    </strong>
                  </div>
                  <div className="think-offer-text">
                    <Markdown text={item.what} />
                  </div>
                  {writable && !item.run ? (
                    <div className="think-offer-actions">
                      <button
                        type="button"
                        className="think-button primary"
                        onClick={() => {
                          void runAction(thread, item);
                        }}
                      >
                        ▶ Run
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div key={i} className="think-error" role="alert">
                  {item.text}
                </div>
              )}
            </Fragment>
          ))}
          {thread.busy && asks.length === 0 ? (
            <Working
              agent={thread.agent}
              since={thread.busySince ?? null}
              doing={runningStep(thread.items)}
            />
          ) : null}
          {asks.map((p) =>
            p.plan ? (
              <PlanCard
                key={p.request}
                plan={p.plan}
                build={thread.purpose === "build"}
                options={p.options}
                onPick={(o) => {
                  setPrompts((ps) => ps.filter((x) => x.request !== p.request));
                  void anur.call("thread:permission", { request: p.request, option: o.id });
                  if (!o.kind.startsWith("allow"))
                    requestAnimationFrame(() => {
                      document.querySelector<HTMLTextAreaElement>(".think .think-input")?.focus();
                    });
                }}
              />
            ) : (
              <div key={p.request} className="think-ask" role="group" aria-label={p.title}>
                <p>{p.title}</p>
                <div className="think-ask-options">
                  {p.options.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className={`think-button${o.kind.startsWith("allow") ? " primary" : ""}`}
                      onClick={() => {
                        setPrompts((ps) => ps.filter((x) => x.request !== p.request));
                        void anur.call("thread:permission", { request: p.request, option: o.id });
                      }}
                    >
                      {o.name}
                    </button>
                  ))}
                </div>
              </div>
            ),
          )}
        </div>
        {notConnected(thread.agent)}
        {error ? <p className="think-error">{error}</p> : null}
        {!thread.busy
          ? (previews.find((p) => p.thread === thread.id)?.parts ?? []).map((part) => (
              <EditCard
                key={part.path.join("\u0000")}
                part={part}
                writable={writable}
                onUse={() => {
                  window.dispatchEvent(
                    new CustomEvent("anur:use-preview", {
                      detail: { thread: thread.id, path: part.path },
                    }),
                  );
                }}
                onShow={() => {
                  window.dispatchEvent(
                    new CustomEvent("anur:show-preview", { detail: { thread: thread.id } }),
                  );
                }}
                onDrop={() => {
                  window.dispatchEvent(
                    new CustomEvent("anur:drop-preview", {
                      detail: { thread: thread.id, path: part.path },
                    }),
                  );
                }}
              />
            ))
          : null}
        {/* Last before the reply box, so Use all is on screen where the chat ends. */}
        {!thread.busy ? (
          <ChangeSet thread={thread} writable={writable} autoApply={editsLand(thread.options)} />
        ) : null}
        {signedOut(thread.agent) ?? (
          <Composer
            placeholder="Reply in this thread"
            sendLabel="Send"
            {...composerAttach}
            pickers={
              <>
                <AgentPicker
                  value={thread.agent}
                  agents={agentsOn ?? []}
                  disabled={thread.busy}
                  onChange={(next) => {
                    if (isDraft) {
                      setDraft((d) => (d ? { ...d, agent: next, options: [] } : d));
                      return;
                    }
                    setThreads((ts) =>
                      ts.map((t) => (t.id === thread.id ? { ...t, agent: next, options: [] } : t)),
                    );
                    void anur.call("thread:agent", { thread: thread.id, agent: next });
                  }}
                />
                {thread.options.map((o) => (
                  <OptionPicker
                    key={o.id}
                    option={o}
                    disabled={thread.busy}
                    onChange={(value) => {
                      if (isDraft) {
                        setDraft((d) =>
                          d
                            ? {
                                ...d,
                                options: d.options.map((x) =>
                                  x.id === o.id ? { ...x, current: value } : x,
                                ),
                              }
                            : d,
                        );
                        return;
                      }
                      setThreads((ts) =>
                        ts.map((t) =>
                          t.id === thread.id
                            ? {
                                ...t,
                                options: t.options.map((x) =>
                                  x.id === o.id ? { ...x, current: value } : x,
                                ),
                              }
                            : t,
                        ),
                      );
                      void anur.call("thread:option", { thread: thread.id, id: o.id, value });
                    }}
                  />
                ))}
                {thread.tokens ? <ContextRing tokens={thread.tokens} /> : null}
              </>
            }
            busy={thread.busy}
            disabled={!writable || thread.path === null}
            onStop={() => {
              if (!thread.id.startsWith("starting:"))
                void anur.call("thread:stop", { thread: thread.id });
            }}
            queue={queued[thread.id] ?? []}
            onQueue={(message) => {
              const files = attached;
              setAttached([]);
              setQueued((q) => ({
                ...q,
                [thread.id]: [
                  ...(q[thread.id] ?? []),
                  { id: ++queuedN.current, text: message, files },
                ],
              }));
            }}
            onUnqueue={(i) => {
              setQueued((q) => ({
                ...q,
                [thread.id]: (q[thread.id] ?? []).filter((_, j) => j !== i),
              }));
            }}
            onSend={async (message) => {
              if (isDraft) return start(message, undefined, thread);
              const ok = await sendReply(thread.id, message, attached);
              if (ok) setAttached([]);
              return ok;
            }}
          />
        )}
      </div>
    );
  }

  const body = bodyOf(docText(), section);
  return (
    <div className={`think think-home${dropOver ? " think-drop" : ""}`} {...dropProps()}>
      <h2
        className="think-section"
        // The heading is the section's name: edit it here as on the page.
        contentEditable={
          writable && section.headingRange && docPath !== FOLDER_DOC ? "plaintext-only" : false
        }
        suppressContentEditableWarning
        spellCheck={false}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            e.currentTarget.textContent = section.path.at(-1) ?? "";
            e.currentTarget.blur();
          }
        }}
        onBlur={(e) => {
          const name = e.currentTarget.textContent.replace(/\s+/g, " ").trim();
          const main = page();
          if (!name || !main || !docPath) {
            e.currentTarget.textContent = section.path.at(-1) ?? "";
            return;
          }
          renameSection(main, docPath.split("/").pop() ?? docPath, section, name);
        }}
      >
        {section.path.at(-1)}
      </h2>
      {SHOW_SECTION_TEXT ? (
        <>
          <div className={`think-text${showText ? " open" : ""}`}>
            {docPath && page() ? (
              <SectionEditor
                key={`${section.path.join("\u0000")}#${String(section.ordinal)}`}
                page={page}
                docPath={docPath}
                section={section}
                editable={writable}
              />
            ) : body ? (
              <Markdown text={body} />
            ) : (
              <p className="quiet">No text yet.</p>
            )}
          </div>
          {body.split("\n").length > 6 || body.length > 400 ? (
            <button
              type="button"
              className="think-more"
              onClick={() => {
                setShowText((s) => !s);
              }}
            >
              {showText ? "Show less" : "Show all its text"}
            </button>
          ) : null}
        </>
      ) : null}
      <SectionFooter>
        {features.links && (links.out.length > 0 || links.into.length > 0) ? (
          <div className="think-links">
            {links.out.length > 0 ? (
              <>
                <div className="think-subhead">Links</div>
                <p className="quiet think-inputs-note">A new thread here reads these too.</p>
                <ul>
                  {links.out.map((l) => (
                    <li key={`${l.doc ?? l.written}#${l.heading ?? ""}`}>
                      {l.doc ? (
                        <button
                          type="button"
                          className="think-link"
                          onClick={() => {
                            window.dispatchEvent(
                              new CustomEvent("anur:open-path", {
                                detail: { path: l.doc, heading: l.heading },
                              }),
                            );
                          }}
                        >
                          {linkLabel(l.doc, l.heading)}
                        </button>
                      ) : (
                        <span
                          className="think-link-broken"
                          title="No doc by that name in the folder"
                        >
                          {l.written} · no such doc
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {links.into.length > 0 ? (
              <details className="think-linked-from">
                <summary className="think-subhead">
                  Linked from ({String(links.into.length)})
                </summary>
                <ul>
                  {links.into.map((l) => (
                    <li key={`${l.doc}#${l.path.join(">")}`}>
                      <button
                        type="button"
                        className="think-link"
                        onClick={() => {
                          window.dispatchEvent(
                            new CustomEvent("anur:open-path", {
                              detail: {
                                path: l.doc,
                                heading: l.path.length > 1 ? l.path.slice(1).join("#") : null,
                              },
                            }),
                          );
                        }}
                      >
                        {linkLabel(l.doc, l.path.length > 1 ? l.path.slice(1).join("#") : null)}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}
        {docPath && docPath !== FOLDER_DOC && features.history ? (
          <SectionHistory
            key={sectionKey}
            docPath={docPath}
            docText={docText}
            section={section}
            writable={writable}
            onThread={(id) => {
              setOpen(id);
            }}
          />
        ) : null}
        {findings.length > 0 ? (
          <details className="think-inputs" open>
            <summary className="think-subhead">
              {findings.some((f) => f.by === "person") ? "Decided and found" : "Findings"} (
              {String(findings.length)})
            </summary>
            <p className="quiet think-inputs-note">
              Kept from earlier threads; new threads here follow them.
            </p>
            <ul>
              {[...findings]
                .sort((a, b) => Number(b.by === "person") - Number(a.by === "person"))
                .map((f) => (
                  <li key={f.id}>
                    <span
                      className="truncate"
                      title={
                        f.by === "person"
                          ? `${f.who ?? "Someone"}${f.at ? `, ${new Date(f.at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}: “${f.quote ?? f.claim}”${f.instead ? `\nInstead of: ${f.instead}` : ""}${f.until ? `\nUntil: ${f.until}` : ""}`
                          : f.source
                            ? `${f.claim} (${f.source})`
                            : f.claim
                      }
                    >
                      {f.by === "person" ? (
                        <span className="think-decided-tag">Decided</span>
                      ) : null}
                      {f.claim}
                      {f.by === "person" && f.who ? (
                        <span className="quiet"> · {f.who}</span>
                      ) : null}
                    </span>
                    {f.disputed ? (
                      <span className="think-lapsed" role="group" aria-label="Disagrees">
                        <span className="think-lapsed-why">
                          Disagrees with “{f.disputed.claim}”
                          {f.disputed.who ? ` (${f.disputed.who})` : ""}: neither holds until
                          someone picks
                        </span>
                        {writable ? (
                          <button
                            type="button"
                            className="think-more"
                            title="Keep this one; the other is dropped, and history keeps both"
                            onClick={() => {
                              const other = f.disputed;
                              if (!other) return;
                              setFindings((all) =>
                                all
                                  .filter((x) => x.id !== other.id)
                                  .map((x) => (x.id === f.id ? { ...x, disputed: null } : x)),
                              );
                              void (other.thread
                                ? anur.call("finding:decide", {
                                    thread: other.thread,
                                    id: other.id,
                                    status: "dropped",
                                  })
                                : anur.call("decision:revise", {
                                    thread: "",
                                    home: other.home ?? "",
                                    id: other.id,
                                    action: "drop",
                                  }));
                            }}
                          >
                            Keep this one
                          </button>
                        ) : null}
                      </span>
                    ) : null}
                    {f.lapsed ? (
                      <span className="think-lapsed" role="group" aria-label="Needs a look">
                        <span className="think-lapsed-why">
                          Needs a look:{" "}
                          {f.lapsed === "until"
                            ? `"until ${f.until ?? ""}" has passed, so new threads don't follow it`
                            : `it was on ${f.section}`}
                        </span>
                        {writable ? (
                          <>
                            <button
                              type="button"
                              className="think-more"
                              title={
                                f.lapsed === "until"
                                  ? "Keep it, with no end date"
                                  : "Keep it for this whole doc"
                              }
                              onClick={() => {
                                setFindings((all) =>
                                  all.map((x) => (x.id === f.id ? { ...x, lapsed: null } : x)),
                                );
                                void anur.call("decision:revise", {
                                  thread: f.thread,
                                  ...(f.home !== undefined ? { home: f.home } : {}),
                                  id: f.id,
                                  action: f.lapsed === "until" ? "keep" : "doc",
                                });
                              }}
                            >
                              {f.lapsed === "until" ? "Keep" : "Keep for the doc"}
                            </button>
                          </>
                        ) : null}
                      </span>
                    ) : null}
                    {writable ? (
                      <button
                        type="button"
                        className="think-input-remove"
                        aria-label="Drop this finding"
                        title="Drop: new threads won't receive it"
                        onClick={() => {
                          setFindings((all) => all.filter((x) => x.id !== f.id));
                          // One only committed, as a teammate's, is dropped where it's kept.
                          void (f.thread
                            ? anur.call("finding:decide", {
                                thread: f.thread,
                                id: f.id,
                                status: "dropped",
                              })
                            : anur.call("decision:revise", {
                                thread: "",
                                home: f.home ?? "",
                                id: f.id,
                                action: "drop",
                              }));
                        }}
                      >
                        ×
                      </button>
                    ) : null}
                  </li>
                ))}
            </ul>
          </details>
        ) : null}
        {inputs.length > 0 || writable ? (
          <details className="think-inputs">
            <summary className="think-subhead">Inputs ({String(inputs.length)})</summary>
            <p className="quiet think-inputs-note">
              What threads here work from: what they picked up, the files you attached and the links
              you wrote. New threads here and below read them too.
            </p>
            <ul>
              {inputs.map((i) => (
                <li key={i.id}>
                  <span className="think-input-source">{i.source}</span>
                  <span className="truncate" title={i.label}>
                    {i.label}
                  </span>
                  {i.trust === "untrusted" ? <span className="quiet">untrusted</span> : null}
                  {i.local ? (
                    <span
                      className="quiet"
                      title="Read from outside the folder: its content stays on the device that read it, and never goes into .anur/ or git"
                    >
                      kept local
                    </span>
                  ) : null}
                  {writable ? (
                    <button
                      type="button"
                      className="think-input-remove"
                      aria-label={`Remove ${i.label}`}
                      title="Remove: new threads won't receive it"
                      onClick={() => {
                        setInputs((all) => all.filter((x) => x.id !== i.id));
                        void anur.call("inputs:remove", {
                          path: docPath,
                          text: docText(),
                          thread: i.thread,
                          input: i.id,
                        });
                      }}
                    >
                      ×
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {extra}
      </SectionFooter>
      {here.length === 0 && loading ? (
        <h3 className="think-subhead think-loading">Loading threads…</h3>
      ) : here.length === 0 ? null : (
        <GroupedThreads threads={here} stateOf={stateOf} onOpen={setOpen} />
      )}
      {closedHere.length > 0 ? (
        <>
          <button
            type="button"
            className="think-more think-closed-toggle"
            aria-expanded={showClosed}
            onClick={() => {
              setShowClosed((v) => !v);
            }}
          >
            {showClosed ? "Hide closed" : `Show closed (${String(closedHere.length)})`}
          </button>
          {showClosed ? <ThreadList threads={closedHere} onOpen={setOpen} /> : null}
        </>
      ) : null}
      <Disagreements
        findings={findings}
        writable={writable}
        onPick={(keep, drop) => {
          setFindings((all) =>
            all
              .filter((x) => x.id !== drop.id)
              .map((x) => (x.id === keep.id ? { ...x, disputed: null } : x)),
          );
          void (drop.thread
            ? anur.call("finding:decide", { thread: drop.thread, id: drop.id, status: "dropped" })
            : anur.call("decision:revise", {
                thread: "",
                home: drop.home ?? "",
                id: drop.id,
                action: "drop",
              }));
        }}
      />
      {scope && (scope.value === "folder" || !scope.docName) ? (
        <RecentThreads
          hide={new Set([...here, ...closedHere].map((t) => t.id))}
          docPath={docPath}
        />
      ) : !scope && elsewhere.length > 0 ? (
        <details className="think-elsewhere">
          <summary className="think-subhead">
            Other threads in this doc ({String(elsewhere.length)})
            {elsewhere.some((t) => stateOf(t) === "needs-you") ? (
              <span className="think-needs-dot" aria-label="Some need you" />
            ) : null}
          </summary>
          {[...new Set(elsewhere.map((t) => t.path?.join(" > ") ?? "A section that's gone"))].map(
            (where) => (
              <div key={where} className="think-elsewhere-group">
                <div className="think-elsewhere-where">{where.split(" > ").at(-1)}</div>
                <ThreadList
                  threads={elsewhere.filter(
                    (t) => (t.path?.join(" > ") ?? "A section that's gone") === where,
                  )}
                  onOpen={setOpen}
                />
              </div>
            ),
          )}
        </details>
      ) : null}
      {docPath ? (
        <Orphans
          docPath={docPath}
          docText={docText}
          threads={threads}
          sections={tree.sections}
          writable={writable}
          onOpen={setOpen}
          onChanged={reload}
        />
      ) : null}
      <div className="think-foot">
        {/* No agent on: only the way to turn one on, below. */}
        {agentsOn?.length === 0 ? null : notConnected(newAgent)}
        {error ? <p className="think-error">{error}</p> : null}
        {features.actions &&
        agentsOn?.length !== 0 &&
        writable &&
        docPath !== FOLDER_DOC &&
        AGENTS[newAgent].runsThreads &&
        !signedOut(newAgent) ? (
          <div className="think-actions" role="group" aria-label="Actions">
            <button
              type="button"
              className="think-more"
              title={`The agent does what this ${noun} describes, with its own tools, in the mode picked below${buildMode ? ` (${buildMode})` : ""}: Plan shows its plan first, Auto acts at once`}
              onClick={() => {
                void start("-", "build");
              }}
            >
              Build this {noun}
            </button>
            <button
              type="button"
              className="think-more"
              title="The agent tests each claim here against what the section links or names, changing nothing"
              onClick={() => {
                void start("-", "check");
              }}
            >
              Check this {noun}
            </button>
          </div>
        ) : null}
        {agentsOn?.length === 0 ? (
          <div className="think-no-agent" role="group" aria-label="No agent">
            <p>Turn on an agent to ask about this.</p>
            <button type="button" className="think-button" onClick={openAgents}>
              Turn on an agent
            </button>
          </div>
        ) : null}
        {agentsOn?.length === 0
          ? null
          : (signedOut(newAgent) ?? (
              <Composer
                placeholder={
                  !writable
                    ? "Threads need a folder Anur can write to"
                    : scope?.value === "folder"
                      ? `Ask about everything in ${scope.folderName}…`
                      : scope?.value === "doc" || section.index === 0
                        ? "Ask about this doc…"
                        : `Ask about this ${noun}…`
                }
                chip={
                  scope ? <ScopeChip scope={scope} section={section} disabled={!!branch} /> : null
                }
                sendLabel="Start thread"
                {...composerAttach}
                pickers={
                  <>
                    <AgentPicker
                      value={newAgent}
                      agents={agentsOn ?? []}
                      disabled={!writable}
                      onChange={setNewAgent}
                    />
                    {newChoices.map((o) => (
                      <OptionPicker
                        key={o.id}
                        option={o}
                        // One agent on, so no agent menu: the model menu leads to the others.
                        onMore={
                          o.id === "model" && (agentsOn ?? []).length <= 1 ? openAgents : null
                        }
                        disabled={!writable}
                        onChange={(value) => {
                          setNewChoices((all) =>
                            all.map((x) => (x.id === o.id ? { ...x, current: value } : x)),
                          );
                        }}
                      />
                    ))}
                  </>
                }
                busy={false}
                disabled={!writable || !AGENTS[newAgent].runsThreads}
                onSend={(m) => start(m)}
              />
            ))}
      </div>
    </div>
  );
}

type Orphan = {
  id: string;
  path: string[];
  threads: { id: string; title: string }[];
  history: boolean;
  suggestion: { index: number; path: string[] } | null;
};

/**
 * Orphaned (11.1, 11.2): sections whose heading is gone, with what was
 * behind them. Reattach moves their threads and history to a live section;
 * Delete removes them at once.
 */
function Orphans({
  docPath,
  docText,
  threads,
  sections,
  writable,
  onOpen,
  onChanged,
}: {
  docPath: string;
  docText: () => string;
  threads: ThreadView[];
  sections: { path: string[] }[];
  writable: boolean;
  onOpen: (id: string) => void;
  onChanged: () => void;
}) {
  const [orphans, setOrphans] = useState<Orphan[]>([]);
  /** The section picker, open on an orphan: its pick so far, -1 for none yet. */
  const [picking, setPicking] = useState<Record<string, number | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  // Read again when the doc's threads or headings change.
  const key = `${threads.map((t) => `${t.id}:${t.path?.join("/") ?? "-"}`).join(",")}|${sections
    .map((s) => s.path.join("/"))
    .join(",")}`;
  const text = useRef(docText);
  text.current = docText;
  useEffect(() => {
    let current = true;
    const t = window.setTimeout(() => {
      void anur.call("orphans:list", { path: docPath, text: text.current() }).then((r) => {
        if (current) setOrphans(r.orphans);
      });
    }, 300);
    return () => {
      current = false;
      window.clearTimeout(t);
    };
  }, [docPath, key, n]);
  if (orphans.length === 0) return null;
  const done = () => {
    setN((x) => x + 1);
    onChanged();
  };
  const reattach = (o: Orphan, index: number) => {
    const target = sections[index];
    if (!target) return;
    setError(null);
    void anur
      .call("orphans:reattach", {
        path: docPath,
        text: text.current(),
        orphan: o.id,
        section: { index, path: target.path },
      })
      .then((r) => {
        if (r.kind === "refused") setError(r.reason);
        setPicking((p) => ({ ...p, [o.id]: undefined }));
        done();
      });
  };
  const remove = (o: Orphan) => {
    const what =
      o.threads.length > 0
        ? `its ${o.threads.length === 1 ? "thread" : `${String(o.threads.length)} threads`}, their proposed edits, its inputs and its history`
        : "its history";
    if (
      !window.confirm(
        `Delete what was behind “${o.path.at(-1) ?? "Untitled"}”: ${what}? This can't be undone.`,
      )
    )
      return;
    setError(null);
    void anur
      .call("orphans:delete", { path: docPath, text: text.current(), orphan: o.id })
      .then(done);
  };
  return (
    <details className="think-elsewhere think-orphans">
      <summary className="think-subhead">Orphaned ({String(orphans.length)})</summary>
      <p className="quiet think-orphans-why">Headings that are gone, with what was behind them.</p>
      {error ? <p className="think-error">{error}</p> : null}
      {orphans.map((o) => {
        const views = o.threads.flatMap((x) => threads.filter((t) => t.id === x.id));
        const choice = picking[o.id];
        const suggested = o.suggestion ? sections[o.suggestion.index] : undefined;
        return (
          <div key={o.id} className="think-elsewhere-group think-orphan">
            <div className="think-orphan-head">
              <span className="think-orphan-gone">{o.path.at(-1) ?? "Untitled"}</span>
              {suggested && choice === undefined ? (
                <span className="quiet"> → {suggested.path.at(-1) ?? "Untitled"}?</span>
              ) : null}
            </div>
            {views.length > 0 ? (
              <ThreadList threads={views} onOpen={onOpen} />
            ) : (
              <p className="quiet">{o.history ? "Its history only" : "Nothing behind it"}</p>
            )}
            {!writable ? null : choice === undefined ? (
              <div className="think-orphan-actions">
                {suggested && o.suggestion ? (
                  <button
                    type="button"
                    className="think-more"
                    onClick={() => {
                      if (o.suggestion) reattach(o, o.suggestion.index);
                    }}
                  >
                    Reattach to {suggested.path.at(-1) ?? "Untitled"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="think-more"
                  onClick={() => {
                    setPicking((p) => ({ ...p, [o.id]: -1 }));
                  }}
                >
                  {suggested ? "Other section…" : "Reattach to…"}
                </button>
                <button
                  type="button"
                  className="think-more danger"
                  onClick={() => {
                    remove(o);
                  }}
                >
                  Delete
                </button>
              </div>
            ) : (
              <div className="think-orphan-actions">
                <select
                  aria-label="Section to reattach to"
                  value={choice}
                  onChange={(e) => {
                    setPicking((p) => ({ ...p, [o.id]: Number(e.target.value) }));
                  }}
                >
                  <option value={-1}>Pick a section…</option>
                  {sections.map((s, i) => (
                    <option key={s.path.join("/")} value={i}>
                      {"  ".repeat(Math.max(0, s.path.length - 1))}
                      {s.path.at(-1) ?? "Untitled"}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="think-more"
                  disabled={choice < 0}
                  onClick={() => {
                    reattach(o, choice);
                  }}
                >
                  Reattach
                </button>
                <button
                  type="button"
                  className="think-more quiet-action"
                  onClick={() => {
                    setPicking((p) => ({ ...p, [o.id]: undefined }));
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        );
      })}
    </details>
  );
}

/** While a turn runs: the agent's mark, what it's doing, and for how long, as Claude shows it. */
function Working({
  agent,
  since,
  doing,
}: {
  agent: AgentId;
  since: number | null;
  doing: string | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(t);
    };
  }, []);
  const secs = since ? Math.max(0, Math.round((now - since) / 1000)) : 0;
  const took =
    secs < 60 ? `${String(secs)}s` : `${String(Math.floor(secs / 60))}m ${String(secs % 60)}s`;
  return (
    <div className="think-working" role="status">
      <span className="think-working-mark">
        <AgentMark agent={agent} />
      </span>
      <span className="think-working-what">{doing ?? "Thinking…"}</span>
      <span className="think-working-time">{took}</span>
    </div>
  );
}

/** The step the agent is on now: its last tool call this turn, if that's still running. */
function runningStep(items: ThreadItem[]): string | null {
  const last = items.at(-1);
  return last?.kind === "tool" &&
    !/^(completed|failed)$/.test(last.status) &&
    !HOUSEKEEPING.test(last.title)
    ? last.title
    : null;
}

type ToolItem = Extract<ThreadItem, { kind: "tool" }>;

/**
 * The thread's items, with each run of two or more tool calls gathered into
 * one fold, as Claude's apps show them: the steps are there, a click away.
 */
/** "Claude · Opus 5.5": the agent, and its model when the session has said. */
function whoLabel(agent: AgentId, options: SessionOption[]): string {
  const model = options.find((o) => o.id === "model");
  const name = model?.choices.find((c) => c.value === model.current)?.name;
  return name ? `${AGENT_SHORT[agent]} · ${name}` : AGENT_SHORT[agent];
}

/** Open a file a thread used: a doc or an image in Anur, anything else in its own app. */
function openFile(rel: string) {
  if (/\.(md|markdown)$/i.test(rel) || /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(rel))
    window.dispatchEvent(new CustomEvent("anur:open-path", { detail: { path: rel } }));
  else void anur.call("doc:reveal", { path: rel, how: "default-app" });
}

/** A file as a card: its type, its name; a folder says so (10.4). */
function FileCard({
  path,
  onOpen,
  onRemove,
}: {
  path: string;
  onOpen?: () => void;
  onRemove?: () => void;
}) {
  const name = path.split("/").pop() ?? path;
  const ext = /\.([a-z0-9]{1,5})$/i.exec(name)?.[1]?.toUpperCase() ?? "";
  return (
    <span className="file-card" title={path}>
      <span className={`file-card-type${ext ? "" : " folder"}`} aria-hidden="true">
        {ext || (
          <svg width="14" height="14" viewBox="0 0 16 16">
            <path
              d="M1.75 4.25a1 1 0 0 1 1-1h3.1l1.4 1.5h5.99a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
            />
          </svg>
        )}
      </span>
      {onOpen ? (
        <button type="button" className="file-card-name truncate" onClick={onOpen}>
          {name}
        </button>
      ) : (
        <span className="file-card-name truncate">{name}</span>
      )}
      {onRemove ? (
        <button
          type="button"
          className="file-card-x"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

/** An agent's reply: who answered (on the first of a turn), the text, and its actions on hover. */
function AgentReply({
  text,
  who,
  onBranch,
  onUse,
  after = null,
}: {
  text: string;
  who: { agent: AgentId; label: string } | null;
  onBranch: (() => void) | null;
  onUse: (() => void) | null;
  /** Under the reply's actions: what this answer made, when its cards follow (answer first). */
  after?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="think-reply">
      {who ? (
        <div className="think-who">
          <AgentMark agent={who.agent} />
          {who.label}
        </div>
      ) : null}
      {/* Always whole, as in Claude chat: a reply grows on screen as it streams. */}
      <div className="think-message agent">
        <Markdown text={text} />
      </div>
      <div className="think-reply-actions">
        <button
          type="button"
          aria-label={copied ? "Copied" : "Copy"}
          title={copied ? "Copied" : "Copy"}
          onClick={() => {
            void anur.call("clipboard:write", { text }).then(() => {
              setCopied(true);
              setTimeout(() => {
                setCopied(false);
              }, 1500);
            });
          }}
        >
          <Icon name={copied ? "copied" : "copy"} />
        </button>
        {onBranch ? (
          <button
            type="button"
            aria-label="Branch from here"
            title="Branch from here: a new thread that knows this chat up to this reply"
            onClick={onBranch}
          >
            <Icon name="branch" />
          </button>
        ) : null}
        {onUse ? (
          <button
            type="button"
            aria-label="Use in doc"
            title="Use in doc: add this reply at the end of the thread's section; ⌘Z takes it back"
            onClick={onUse}
          >
            <Icon name="use" />
          </button>
        ) : null}
      </div>
      {after}
    </div>
  );
}

/** Anur's own bookkeeping, never shown as the agent's work. */
// Steps a person never needs, and steps a card in the chat already stands for.
const HOUSEKEEPING =
  /^(mcp__anur__anur_(name_thread|list_inputs|propose_finding|offer_options|report_check)|ToolSearch)\b/;

type Folded = { item: ThreadItem; i: number; steps: ToolItem[] | null; leads?: boolean };

function foldSteps(items: ThreadItem[], busy?: boolean): Folded[] {
  const out: Folded[] = [];
  let run: ToolItem[] = [];
  let start = 0;
  const flush = () => {
    const [first] = run;
    if (run.length === 1 && first) out.push({ item: first, i: start, steps: null });
    else if (first) out.push({ item: first, i: start, steps: run });
    run = [];
  };
  items.forEach((item, i) => {
    if (item.kind === "tool" && HOUSEKEEPING.test(item.title)) return;
    if (item.kind === "tool") {
      if (run.length === 0) start = i;
      run.push(item);
      return;
    }
    flush();
    out.push({ item, i, steps: null });
  });
  flush();
  return busy === undefined ? out : answerFirst(out, busy);
}

const CARD_KINDS = new Set(["finding", "options"]);

/**
 * A finished turn's reply leads it: the agent writes its answer last, after
 * the findings and options it made on the way, but a person reads the
 * answer first. The reply moves above the turn's first card, and the cards
 * follow under "From this answer". A running turn stays in the order it
 * arrives.
 */
function answerFirst(entries: Folded[], busy: boolean): Folded[] {
  const out: Folded[] = [];
  let turn: Folded[] = [];
  const flushTurn = (last: boolean) => {
    const reply = turn.findLastIndex((e) => e.item.kind === "message" && e.item.role === "agent");
    const card = turn.findIndex((e) => CARD_KINDS.has(e.item.kind));
    const at = reply >= 0 ? turn[reply] : undefined;
    if (at && card >= 0 && card < reply && !(last && busy)) {
      turn.splice(reply, 1);
      turn.splice(card, 0, { ...at, leads: true });
    }
    out.push(...turn);
    turn = [];
  };
  for (const e of entries) {
    if (e.item.kind === "message" && e.item.role === "person") flushTurn(false);
    turn.push(e);
  }
  flushTurn(true);
  return out;
}

/** A run of tool calls as one line: how many, and what the last few did; open for all of them. */
function StepsFold({ steps, running }: { steps: ToolItem[]; running: boolean }) {
  // A doc edit Anur sent to the working copy "fails" first, then runs there: not a failure.
  const redirected = (t: ToolItem) =>
    t.status === "failed" &&
    steps.some((x) => {
      const m = /^(\w+) (.+)$/.exec(t.title);
      return m !== null && x.title === `${m[1] ?? ""} working copy of ${m[2] ?? ""}`;
    });
  // While running, the step under way; after, what the run did. A step that
  // failed shows ×, opened: the agent usually recovers, so the summary doesn't say so.
  const last = running
    ? toolLabel(steps.at(-1)?.title ?? "")
    : stepsSummary(steps.filter((t) => !redirected(t)));
  return (
    <details className="think-steps">
      <summary>
        <span className="think-steps-count">
          {String(steps.filter((t) => !redirected(t)).length)} steps{running ? " so far" : ""}
        </span>
        <span className="think-steps-last truncate">{last}</span>
      </summary>
      <div className="think-steps-list">
        {steps.map((t) =>
          redirected(t) ? null : (
            <div key={t.toolUse} className={`think-tool ${t.status}`} title={t.title}>
              {t.status === "failed" ? "× " : ""}
              {serviceOf(t.title) ? <ServiceIcon service={serviceOf(t.title)} /> : null}
              {toolLabel(t.title)}
            </div>
          ),
        )}
      </div>
    </details>
  );
}

const VERDICT: Record<"holds" | "wrong" | "unsupported" | "missing", string> = {
  holds: "Holds",
  wrong: "Wrong",
  unsupported: "Unsupported",
  missing: "Missing",
};

/** A check's report: each claim with what it was tested against. */
function CheckCard({
  claims,
  corrected,
  onKeep,
}: {
  /** Keep what a wrong or missing claim's source says as a finding (16.2). */
  onKeep: ((claim: string, source: string | null) => void) | null;
  claims: {
    claim: string;
    verdict: keyof typeof VERDICT;
    source: string;
    note: string;
    about?: "fact" | "wording" | undefined;
  }[];
  corrected: boolean;
}) {
  const [kept, setKept] = useState<Set<number>>(new Set());
  // What needs a look first, in this order; what holds folds away.
  const order = ["wrong", "missing", "unsupported"] as const;
  const problems = order.flatMap((v) => claims.filter((c) => c.verdict === v));
  const fine = claims.filter((c) => c.verdict === "holds");
  const said = order
    .map((v) => [v, claims.filter((c) => c.verdict === v).length] as const)
    .filter(([, n]) => n > 0)
    .map(
      ([v, n]) =>
        `${String(n)} ${n === 1 ? "is" : "are"} ${v === "unsupported" ? "unsupported" : v}`,
    );
  const row = (c: (typeof claims)[number], i: number) => (
    <li key={i} className={`think-claim ${c.verdict}`}>
      <div className="think-claim-line">
        <span className="think-verdict">{VERDICT[c.verdict]}</span>
        <span>{c.claim}</span>
      </div>
      <div className="quiet think-claim-note">
        {c.note}{" "}
        <span className="think-source" title={c.source}>
          source
        </span>
        {/* Only a fact is worth carrying to new threads, not a typo (17.3). */}
        {onKeep && (c.verdict === "wrong" || c.verdict === "missing") && c.about !== "wording" ? (
          kept.has(claims.indexOf(c)) ? (
            <span className="think-kept"> · kept as a finding</span>
          ) : (
            <>
              {" · "}
              <button
                type="button"
                className="think-link"
                title="New threads on this section will know it, with its source"
                onClick={() => {
                  onKeep(c.note, c.source || null);
                  setKept((k) => new Set(k).add(claims.indexOf(c)));
                }}
              >
                Keep as a finding
              </button>
            </>
          )
        ) : null}
      </div>
    </li>
  );
  return (
    <div className="think-check" role="group" aria-label="Check">
      <p className="think-check-head">
        <strong>
          {problems.length === 0
            ? `All ${countOf(claims.length, "claim")} hold`
            : `Of ${countOf(claims.length, "claim")}, ${said.join(", ")}`}
        </strong>
      </p>
      {problems.length > 0 ? <ul>{problems.map(row)}</ul> : null}
      {fine.length > 0 && problems.length > 0 ? (
        <details className="think-check-fine">
          <summary className="quiet">{countOf(fine.length, "claim")} hold</summary>
          <ul>{fine.map(row)}</ul>
        </details>
      ) : null}
      {corrected ? (
        <button
          type="button"
          className="think-link think-check-fix"
          onClick={() => {
            document
              .querySelector(".think-offer.edit")
              ?.scrollIntoView({ block: "center", behavior: "smooth" });
          }}
        >
          The corrected text is ready to use, below
        </button>
      ) : null}
    </div>
  );
}

/**
 * A finding the agent proposed (16.1): keep it, reworded if needed, or drop
 * it. Kept, it reaches every new thread on this section, with its source.
 */
function FindingCard({
  item,
  thread,
  writable,
}: {
  item: {
    id: string;
    claim: string;
    source: string | null;
    status: "proposed" | "kept" | "dropped";
    scope?: Scope | undefined;
    by?: "person" | undefined;
    quote?: string | null | undefined;
    instead?: string | null | undefined;
    until?: string | null | undefined;
    who?: string | null | undefined;
    auto?: boolean | undefined;
  };
  thread: string;
  writable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.claim);
  const decide = (status: "kept" | "dropped", claim: string | null = null, scope?: Scope) => {
    setEditing(false);
    void anur.call("finding:decide", {
      thread,
      id: item.id,
      status,
      claim,
      ...(scope ? { scope } : {}),
    });
  };
  if (item.by === "person") return <DecisionCard item={item} writable={writable} decide={decide} />;
  if (item.status !== "proposed")
    return (
      <div className={`think-finding ${item.status}`} role="status">
        <span className="think-finding-label">
          {item.status === "kept" ? "Finding kept" : "Finding dropped"}
        </span>{" "}
        {item.claim}
        {item.source ? <span className="quiet"> · {item.source}</span> : null}
      </div>
    );
  return (
    <div className="think-finding proposed" role="group" aria-label="Finding">
      <div className="think-finding-label">Finding</div>
      {editing ? (
        <textarea
          className="think-input think-finding-edit"
          value={text}
          rows={2}
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
      ) : (
        <div>{item.claim}</div>
      )}
      {item.source ? <div className="quiet think-claim-note">From {item.source}</div> : null}
      {writable ? (
        <div className="think-offer-actions">
          <button
            type="button"
            className="think-button primary"
            title="New threads on this section will know it"
            onClick={() => {
              decide("kept", editing && text.trim() !== item.claim ? text : null);
            }}
          >
            Keep
          </button>
          {editing ? null : (
            <button
              type="button"
              className="think-more"
              onClick={() => {
                setEditing(true);
              }}
            >
              Edit
            </button>
          )}
          <button
            type="button"
            className="think-more"
            onClick={() => {
              decide("dropped");
            }}
          >
            Drop
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** How far a decision reaches (18.3): set from the person's words, never picked here. */
type Scope = "section" | "doc" | "folder" | "everywhere";

/**
 * A decision a person made, in their words. Settled by itself, it's one
 * quiet line with Undo; when the agent was unsure, or the words were a
 * question, it asks once: keep it for later work, or just this once.
 */
function DecisionCard({
  item,
  writable,
  decide,
}: {
  item: {
    claim: string;
    status: "proposed" | "kept" | "dropped";
    scope?: Scope | undefined;
    quote?: string | null | undefined;
    instead?: string | null | undefined;
    until?: string | null | undefined;
    who?: string | null | undefined;
    auto?: boolean | undefined;
  };
  writable: boolean;
  decide: (status: "kept" | "dropped", claim?: string | null, scope?: Scope) => void;
}) {
  const said = item.who ? `${item.who}: ` : "";
  const extra = [
    item.instead ? `instead of ${item.instead}` : null,
    item.until ? `until ${item.until}` : null,
  ].filter(Boolean);
  if (item.status !== "proposed")
    return (
      <div
        className={`think-decided${item.status === "dropped" ? " undone" : ""}`}
        role="status"
        title={item.quote ? `${said}“${item.quote}”` : undefined}
      >
        <span className="think-decided-mark" aria-hidden="true">
          {item.status === "dropped" ? "·" : "✓"}
        </span>
        <span>
          {item.status === "dropped" ? "Not kept: " : "Decided: "}
          {item.claim}
          {extra.length ? <span className="quiet"> ({extra.join(", ")})</span> : null}
          {item.who ? <span className="quiet"> · {item.who}</span> : null}
        </span>
        {writable && item.status === "kept" && item.auto ? (
          <button
            type="button"
            className="think-more"
            title="It won't reach new threads"
            onClick={() => {
              decide("dropped");
            }}
          >
            Undo
          </button>
        ) : null}
      </div>
    );
  return (
    <div className="think-finding proposed" role="group" aria-label="Decision">
      <div className="think-finding-label">Keep this for later work?</div>
      {item.quote ? (
        <div className="think-decided-quote">
          {said}“{item.quote}”
        </div>
      ) : null}
      <div>{item.claim}</div>
      {extra.length ? <div className="quiet think-claim-note">{extra.join(" · ")}</div> : null}
      {writable ? (
        <div className="think-offer-actions">
          <button
            type="button"
            className="think-button primary"
            title="New threads where it applies will follow it"
            onClick={() => {
              decide("kept", null, item.scope);
            }}
          >
            Keep
          </button>
          <button
            type="button"
            className="think-more"
            onClick={() => {
              decide("dropped");
            }}
          >
            Just this once
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** The plan an agent wants approved before it acts. */
function PlanCard({
  plan,
  build,
  options,
  onPick,
}: {
  plan: string;
  build: boolean;
  options: Prompt["options"];
  onPick: (o: Prompt["options"][number]) => void;
}) {
  const allow =
    options.find((o) => o.kind === "allow_once") ?? options.find((o) => o.kind.startsWith("allow"));
  const reject = options.find((o) => o.kind.startsWith("reject"));
  return (
    <div className="think-plan" role="group" aria-label="Plan">
      <p className="think-plan-head">
        <strong>{build ? "The plan, before it builds" : "The plan, before it acts"}</strong>
        <span className="quiet"> · nothing has changed yet</span>
      </p>
      <div className="think-plan-text">
        <Markdown text={plan} />
      </div>
      <div className="think-ask-options">
        {allow ? (
          <button
            type="button"
            className="think-button primary"
            onClick={() => {
              onPick(allow);
            }}
          >
            {build ? "Approve and build" : "Approve and run"}
          </button>
        ) : null}
        {reject ? (
          <button
            type="button"
            className="think-more"
            onClick={() => {
              onPick(reject);
            }}
          >
            Keep planning
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Settings → Agents, where agents are switched on and off. */
const openAgents = () => {
  window.dispatchEvent(new CustomEvent("anur:open-settings", { detail: { section: "agent" } }));
};

/**
 * Which agent a thread runs on, among those switched on. With one agent on
 * there's nothing to pick, so it isn't shown; the menu ends in More agents….
 */
function AgentPicker({
  value,
  agents,
  disabled,
  onChange,
}: {
  value: AgentId;
  agents: readonly AgentId[];
  disabled: boolean;
  onChange: (agent: AgentId) => void;
}) {
  // A thread on an agent since switched off still names it.
  const shown = agents.includes(value) ? agents : [value, ...agents];
  if (shown.length <= 1) return null;
  return (
    <label className="think-option">
      <span className="think-pick" title={AGENTS[value].name}>
        <AgentMark agent={value} />
        {AGENT_SHORT[value]}
      </span>
      <select
        aria-label="Agent"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value === MORE) {
            openAgents();
            return;
          }
          const next = shown.find((id) => id === e.target.value);
          if (next) onChange(next);
        }}
      >
        {shown.map((id) => (
          <option key={id} value={id}>
            {AGENTS[id].name}
          </option>
        ))}
        <option value={MORE}>More agents…</option>
      </select>
    </label>
  );
}

const MORE = "__more_agents";

type ThreadState = "needs-you" | "running" | "done";

/**
 * A section's threads by what they need from the person: those that need
 * them first, then those running, then those done, folded away.
 */
function GroupedThreads({
  threads,
  stateOf,
  onOpen,
}: {
  threads: ThreadView[];
  stateOf: (t: ThreadView) => ThreadState;
  onOpen: (id: string) => void;
}) {
  const needs = threads.filter((t) => stateOf(t) === "needs-you");
  const rest = threads.filter((t) => stateOf(t) !== "needs-you");
  return (
    <div className="think-groups">
      {needs.length > 0 ? (
        <>
          <h3 className="think-subhead">
            <span className="think-needs-dot" aria-hidden="true" />
            Needs you ({String(needs.length)})
          </h3>
          <ThreadList threads={needs} onOpen={onOpen} />
        </>
      ) : null}
      {/* The rest under their own heading, so they never read as needing you too. */}
      {needs.length > 0 && rest.length > 0 ? (
        <h3 className="think-subhead">Others ({String(rest.length)})</h3>
      ) : null}
      <ThreadList threads={withBranches(rest)} onOpen={onOpen} />
    </div>
  );
}

/** Newest first, each branch right under the thread it came from (10.5). */
function withBranches(threads: ThreadView[]): ThreadView[] {
  const newest = [...threads].sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
  const ids = new Set(newest.map((t) => t.id));
  const out: ThreadView[] = [];
  const place = (t: ThreadView) => {
    out.push(t);
    for (const b of newest) if (b.branchedFrom?.thread === t.id) place(b);
  };
  for (const t of newest) {
    const from = t.branchedFrom?.thread;
    if (!from || !ids.has(from)) place(t);
  }
  return out;
}

/** Threads as buttons: their question, where they are, and how far they've got. */
/** Anur's own tools, named for the person rather than by their ids. */
const OWN_TOOLS: Record<string, string> = {
  anur_name_thread: "Named the thread",
  anur_list_inputs: "Looked at the section's inputs",
  anur_read_input: "Read an input",
  anur_report_check: "Reported the check",
  anur_offer_options: "Offered options",
  anur_propose_action: "Proposed an action",
  anur_note_decision: "Noted a decision",
  anur_propose_finding: "Proposed a finding",
  anur_search_sections: "Searched the doc",
  anur_read_section: "Read a section",
  anur_links: "Looked up the section's links",
};

function toolLabel(title: string): string {
  if (title === "Approve Plan") return "Asked you to approve the plan";
  if (/^Write \S*\/\.claude\/plans\//.test(title)) return "Wrote the plan";
  const own = /^mcp__anur__(\w+)/.exec(title)?.[1];
  if (own) return OWN_TOOLS[own] ?? own.replace(/^anur_/, "").replace(/_/g, " ");
  // A service the agent acted in: "Linear: save issue", shown with its mark.
  const service = serviceOf(title);
  if (service) return `${service.name}: ${service.action}`;
  return stepOf(title).label;
}

/** A finished run in one line: the files it read, then anything else it did. */
function stepsSummary(steps: { title: string }[]): string {
  const all = steps.map((t) => (t.title.startsWith("mcp__anur__") ? null : stepOf(t.title)));
  const read = all.flatMap((x) => x?.read ?? []);
  const other = [...new Set(all.flatMap((x) => (x && x.read.length === 0 ? [x.label] : [])))];
  const parts = [...(read.length ? [`Read ${listOf(read)}`] : []), ...other];
  return parts.length ? parts.slice(0, 3).join(", ") : toolLabel(steps.at(-1)?.title ?? "");
}

type HistoryList = {
  versions: {
    id: string;
    at: string;
    cause: string;
    summary: string;
    text: string;
    thread: string | null;
  }[];
  commits: { hash: string; at: string; author: string; subject: string; text: string }[];
};

const CAUSE: Record<string, string> = {
  start: "First seen",
  typing: "Typed",
  apply: "From a thread",
  restore: "Restored",
  outside: "Changed outside",
};

/** A version's lines against the section now: kept, only in this version, or only now (5.2). */
function versusNow(
  version: string,
  now: string,
): { kind: "same" | "differs" | "gone"; text: string }[] {
  const a = now.split("\n");
  const b = version.split("\n");
  const out: { kind: "same" | "differs" | "gone"; text: string }[] = [];
  let bi = 0;
  for (const h of diffLines(a, b)) {
    while (bi < h.bFrom) out.push({ kind: "same", text: b[bi++] ?? "" });
    for (let ai = h.aFrom; ai < h.aTo; ai++) out.push({ kind: "gone", text: a[ai] ?? "" });
    for (; bi < h.bTo; bi++) out.push({ kind: "differs", text: b[bi] ?? "" });
  }
  while (bi < b.length) out.push({ kind: "same", text: b[bi++] ?? "" });
  return out;
}

/** "4m", "2h", "Yesterday", "14 Nov": short, for a thread card. */
function ago(at: string): string {
  const ms = Date.now() - new Date(at).getTime();
  if (ms < 60_000) return "now";
  if (ms < 3_600_000) return `${String(Math.round(ms / 60_000))}m`;
  if (ms < 86_400_000) return `${String(Math.round(ms / 3_600_000))}h`;
  if (ms < 2 * 86_400_000) return "Yesterday";
  return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** "3 min ago", "2 h ago", "14 Nov". */
function when(at: string): string {
  const ms = Date.now() - new Date(at).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${String(Math.round(ms / 60_000))} min ago`;
  if (ms < 86_400_000) return `${String(Math.round(ms / 3_600_000))} h ago`;
  return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * A section's history (group 5): its versions newest first, and in a git
 * repo the commits that changed it. Each opens to its text, with the lines
 * that differ from now marked, and restores into this section only.
 */
function SectionHistory({
  docPath,
  docText,
  section,
  writable,
  onThread,
}: {
  docPath: string;
  docText: () => string;
  section: SectionNode;
  writable: boolean;
  onThread: (id: string) => void;
}) {
  const [list, setList] = useState<HistoryList | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const load = () => {
    void anur
      .call("history:list", {
        path: docPath,
        text: docText(),
        section: { index: section.index, path: section.path },
      })
      .then(setList);
  };
  const now = docText().slice(section.subtreeRange.from, section.subtreeRange.to).trimEnd();
  const rows = [
    ...(list?.versions ?? []).map((v) => ({
      key: v.id,
      at: v.at,
      label: CAUSE[v.cause] ?? v.cause,
      summary: v.summary,
      text: v.text,
      thread: v.thread,
    })),
    ...(list?.commits ?? []).map((c) => ({
      key: c.hash,
      at: c.at,
      label: "Commit",
      summary: `${c.subject} (${c.author})`,
      text: c.text,
      thread: null,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <details
      className="think-history"
      onToggle={(e) => {
        if (e.currentTarget.open && !list) load();
      }}
    >
      <summary className="think-subhead">History{list ? ` (${String(rows.length)})` : ""}</summary>
      {list && rows.length === 0 ? (
        <p className="quiet think-inputs-note">No earlier versions of this section yet.</p>
      ) : null}
      <ul>
        {rows.map((r) => {
          const current = r.text.trimEnd() === now;
          const open = shown === r.key;
          return (
            <li key={r.key} className={open ? "open" : undefined}>
              <button
                type="button"
                className="think-history-row"
                onClick={() => {
                  setShown(open ? null : r.key);
                }}
              >
                <span className="think-history-when">{when(r.at)}</span>
                <span className="think-history-cause">{r.label}</span>
                <span className="think-history-summary truncate">{r.summary}</span>
                {current ? <span className="quiet">now</span> : null}
              </button>
              {open ? (
                <div className="think-history-body">
                  <pre className="think-history-text">
                    {versusNow(r.text.trimEnd(), now).map((l, i) => (
                      <span key={i} className={l.kind === "same" ? undefined : l.kind}>
                        {l.text}
                        {"\n"}
                      </span>
                    ))}
                  </pre>
                  <p className="quiet think-history-key">
                    <span className="differs">Only here</span>{" "}
                    <span className="gone">Only now</span>
                  </p>
                  <div className="think-offer-actions">
                    {writable && !current ? (
                      <button
                        type="button"
                        className="think-button primary"
                        onClick={() => {
                          window.dispatchEvent(
                            new CustomEvent("anur:restore-section", {
                              detail: { path: section.path, text: r.text, from: r.at },
                            }),
                          );
                          setShown(null);
                          window.setTimeout(load, 800);
                        }}
                      >
                        Restore this version
                      </button>
                    ) : null}
                    {r.thread ? (
                      <button
                        type="button"
                        className="think-more"
                        onClick={() => {
                          if (r.thread) onThread(r.thread);
                        }}
                      >
                        Open its thread
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/**
 * A thread's change set (9.3): one bar at the foot of the chat, with every
 * edit it proposes now counted; each edit has its own card above, and Use all
 * uses every one (9.4). With "as they land" on, what is left here is what
 * clashed with typing.
 */
function ChangeSet({
  thread,
  writable,
  autoApply,
}: {
  thread: ThreadView;
  writable: boolean;
  autoApply: boolean;
}) {
  const set = thread.changeSet ?? [];
  const count = set.reduce((n, d) => n + d.sections.length, 0);
  // Saving can take a moment (an offloaded iCloud file waits on its download): say so at once.
  const [using, setUsing] = useState(false);
  useEffect(() => {
    const done = (e: Event) => {
      if ((e as CustomEvent<{ thread: string }>).detail.thread === thread.id) setUsing(false);
    };
    window.addEventListener("anur:use-all-done", done);
    return () => {
      window.removeEventListener("anur:use-all-done", done);
    };
  }, [thread.id]);
  // No page took it (none open): the button comes back rather than stay waiting.
  useEffect(() => {
    if (!using) return;
    const t = setTimeout(() => {
      setUsing(false);
    }, 60_000);
    return () => {
      clearTimeout(t);
    };
  }, [using]);
  if (count < 2) return null;
  const docs = set.map((d) => d.doc.replace(/\.md$/i, "")).join(", ");
  return (
    <div className="think-changeset" role="group" aria-label="Edits from this thread">
      <div className="think-changeset-text">
        <strong>{autoApply ? `${countOf(count, "edit")} kept` : countOf(count, "edit")}</strong>
        {autoApply ? " as proposals" : ` in ${docs}`}
        <span className="quiet">
          {autoApply ? "Their sections changed" : "Not in the docs yet"}
        </span>
      </div>
      {writable ? (
        <button
          type="button"
          className="think-button primary"
          disabled={using}
          onClick={() => {
            setUsing(true);
            window.dispatchEvent(
              new CustomEvent("anur:use-all", { detail: { thread: thread.id } }),
            );
          }}
        >
          {using ? "Using…" : `Use all ${String(count)}`}
        </button>
      ) : null}
    </div>
  );
}

/**
 * What a section draws on and how it got here, at the foot of the right
 * panel like the outline in the left: its links, what links to it, its
 * inputs and its history. Folded by default; the fold is remembered.
 */
function SectionFooter({ children }: { children: React.ReactNode }) {
  const [open, setOpenState] = useState(() => {
    try {
      return window.localStorage.getItem("anur.sectionContext") === "open";
    } catch {
      return false;
    }
  });
  return (
    <details
      className="think-context"
      open={open}
      onToggle={(e) => {
        const now = e.currentTarget.open;
        setOpenState(now);
        try {
          window.localStorage.setItem("anur.sectionContext", now ? "open" : "closed");
        } catch {
          // A remembered fold is a nicety.
        }
      }}
    >
      <summary className="left-outline-head">Context and history</summary>
      <div className="right-footer-body">{children}</div>
    </details>
  );
}

/** A linked section as a person reads it: "Pricing › Plans". */
const linkLabel = (doc: string, heading: string | null) =>
  [doc.replace(/\.md$/i, "").split("/").pop() ?? doc, ...(heading ? heading.split("#") : [])].join(
    " › ",
  );

/**
 * Think's copy of the section's text, under its heading. Off for now: the
 * page shows the text, and hovering a map box shows it too. Kept, to turn
 * back on if it's missed.
 */
const SHOW_SECTION_TEXT: boolean = false;

const PURPOSE = { build: "Build", check: "Check" } as const;

/** A thread's title, tagged Build or Check when it's an action (15.7). */
export function ThreadName({ thread }: { thread: ThreadView }) {
  if (!thread.purpose) return <>{thread.title}</>;
  const tag = PURPOSE[thread.purpose];
  const title = thread.title.startsWith(`${tag}: `)
    ? thread.title.slice(tag.length + 2)
    : thread.title;
  const state = thread.action?.state ?? "running";
  return (
    <>
      <span className={`thread-state ${state}`} title={`${tag} · ${STATE_WORD[state]}`}>
        {STATE_MARK[state]}
      </span>
      {title}
    </>
  );
}

const STATE_MARK = { running: "⟳", needs: "!", done: "✓", failed: "×", stopped: "■" } as const;
const STATE_WORD = {
  running: "Running",
  needs: "Needs you",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
} as const;

/**
 * Where a branch thread sits: the decision it started from, then each option
 * it narrows, oldest first ("Activation event › Dashboard saved on own data").
 */
export function exploresPath(thread: ThreadView, threads: ThreadView[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let up = thread.explores ?? null;
  while (up && !seen.has(up.thread)) {
    seen.add(up.thread);
    const option = up.option;
    const from = threads.find((t) => t.id === up?.thread);
    if (!from) break;
    const offer = from.items.find(
      (x) => x.kind === "options" && x.options.some((o) => o.id === option),
    );
    if (offer?.kind !== "options") break;
    const o = offer.options.find((x) => x.id === option);
    if (o) out.unshift(o.title);
    up = from.explores ?? null;
    if (!up) out.unshift(offer.heading ?? from.title);
  }
  return out;
}

function ThreadList({
  threads,
  onOpen,
  showSection = false,
}: {
  threads: ThreadView[];
  onOpen: (id: string) => void;
  showSection?: boolean;
}) {
  if (threads.length === 0) return null;
  return (
    <ul className="think-threads">
      {threads.map((t) => (
        <li key={t.id}>
          <button
            type="button"
            className={`think-thread${t.branchedFrom && threads.some((x) => x.id === t.branchedFrom?.thread) ? " branch" : ""}`}
            onClick={() => {
              onOpen(t.id);
            }}
          >
            {showSection ? (
              <span className="think-thread-where">
                {t.path ? t.path.at(-1) : "A section that's gone"}
              </span>
            ) : null}
            <span className="think-thread-top">
              <span className="think-thread-title">
                <ThreadName thread={t} />
              </span>
              {t.by || t.lastAt ? (
                <span className="think-thread-when">
                  {t.by ? <span className="think-thread-by">{t.by}</span> : null}
                  {t.by && t.lastAt ? ", " : ""}
                  {t.lastAt ? ago(t.lastAt) : ""}
                </span>
              ) : null}
            </span>
            <span className="think-thread-last">
              {t.busy ? (
                <>
                  <span className="think-running-dot" aria-hidden="true" />
                  Running…
                </>
              ) : (
                (t.lastReply ?? "No reply yet")
              )}
            </span>
            <span className="think-thread-meta">
              {`${countOf(t.items.filter((i) => i.kind === "message").length, "message")}${
                t.tokens ? ` · ${formatTokens(t.tokens.used)} tokens` : ""
              }`}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Newly read choices, keeping what the person already picked where it is still offered. */
function withPicks(fresh: SessionOption[], now: SessionOption[]): SessionOption[] {
  return fresh.map((o) => {
    const picked = now.find((x) => x.id === o.id)?.current;
    return picked && o.choices.some((c) => c.value === picked) ? { ...o, current: picked } : o;
  });
}

/** One of the agent's own choices for a session, such as its mode or model. */
function OptionPicker({
  option,
  disabled,
  onChange,
  onMore = null,
}: {
  option: SessionOption;
  disabled: boolean;
  onChange: (value: string) => void;
  /** A last item that opens Settings → Agents, when no agent menu is shown. */
  onMore?: (() => void) | null;
}) {
  return (
    <label className="think-option">
      <span className="think-pick">
        {option.choices.find((c) => c.value === option.current)?.name ?? option.current}
      </span>
      <select
        aria-label={option.name}
        value={option.current}
        disabled={disabled}
        title={option.choices.find((c) => c.value === option.current)?.description ?? undefined}
        onChange={(e) => {
          if (e.target.value === MORE) {
            onMore?.();
            return;
          }
          onChange(e.target.value);
        }}
      >
        {option.choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.name}
          </option>
        ))}
        {onMore ? <option value={MORE}>More agents…</option> : null}
      </select>
    </label>
  );
}

/**
 * The agent isn't signed in: its own sign-ins, each run by Anur without a
 * terminal (3.16). The sign-in opens in the browser; once it's done, the
 * agent restarts and this goes away.
 */
function SignInCard({ e }: { e: AgentSignIn }) {
  const name = AGENTS[e.agent].name;
  const waiting = e.signIn?.phase === "waiting";
  return (
    <div className="think-signin" role="group" aria-label={`Sign in to ${name}`}>
      <p className="think-signin-title">{name} isn't signed in</p>
      {waiting ? (
        <>
          <p className="quiet">Finish signing in in your browser. This updates when you're done.</p>
          <div className="think-signin-actions">
            {e.signIn?.url ? (
              <button
                type="button"
                className="think-button"
                onClick={() => {
                  void anur.call("link:open-external", { url: e.signIn?.url ?? "" });
                }}
              >
                Open the sign-in page again
              </button>
            ) : null}
            <button
              type="button"
              className="think-button"
              onClick={() => {
                void anur.call("agent:sign-in-cancel", { agent: e.agent });
              }}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="quiet">
            Threads run on your own {name} account. Sign in once here; it's the same sign-in as in
            your terminal.
          </p>
          {e.signIn?.phase === "failed" && e.signIn.message ? (
            <p className="think-error">{e.signIn.message}</p>
          ) : null}
          <div className="think-signin-actions">
            {e.auth.methods.map((m, i) => (
              <button
                key={m.id}
                type="button"
                className={`think-button${i === 0 ? " primary" : ""}`}
                title={m.description ?? undefined}
                onClick={() => {
                  void anur.call("agent:sign-in", { agent: e.agent, method: m.id });
                }}
              >
                {signInLabel(m.name)}
              </button>
            ))}
          </div>
          {e.auth.methods.length === 0 ? (
            <p className="quiet">
              Sign in from a terminal with <code>claude</code>, then come back.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/** A sign-in's button: what it is, in plain words. */
const signInLabel = (name: string) =>
  /subscription/i.test(name)
    ? "Sign in with your Claude account"
    : /console/i.test(name)
      ? "Use an Anthropic Console account"
      : `Sign in: ${name}`;

type Disputable = {
  id: string;
  thread: string;
  claim: string;
  quote?: string | null | undefined;
  who?: string | null | undefined;
  at?: string | undefined;
  section: string;
  home?: string | undefined;
  disputed?: { id: string; thread: string; home?: string | undefined } | null | undefined;
};

/**
 * Decisions here that disagree (18.4, 29.9): each pair in full, in the
 * people's own words, and neither holds until someone keeps one; the other
 * is dropped, and history keeps both.
 */
function Disagreements({
  findings,
  writable,
  onPick,
}: {
  findings: readonly Disputable[];
  writable: boolean;
  onPick: (keep: Disputable, drop: Disputable) => void;
}) {
  const seen = new Set<string>();
  const pairs: [Disputable, Disputable][] = [];
  for (const f of findings) {
    const other = f.disputed ? findings.find((x) => x.id === f.disputed?.id) : undefined;
    if (!other || seen.has(f.id) || seen.has(other.id)) continue;
    seen.add(f.id);
    seen.add(other.id);
    pairs.push((f.at ?? "") <= (other.at ?? "") ? [f, other] : [other, f]);
  }
  if (!pairs.length) return null;
  const when = (at: string | undefined) =>
    at ? new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : null;
  return (
    <>
      {pairs.map(([a, b]) => (
        <div
          key={`${a.id}:${b.id}`}
          className="think-disagree"
          role="group"
          aria-label="Decisions that disagree"
        >
          <span className="think-disagree-tag">These disagree · neither holds yet</span>
          {[a, b].map((d) => (
            <div key={d.id} className="think-disagree-side">
              <div className="think-disagree-words">“{d.quote ?? d.claim}”</div>
              <div className="quiet">
                {/* A name shows only on someone else's; one's own reads "You". */}
                {[d.who ?? "You", when(d.at), d.section].filter(Boolean).join(" · ")}
              </div>
              {writable ? (
                <button
                  type="button"
                  className="think-more"
                  title="Keep this one; the other is dropped, and history keeps both"
                  onClick={() => {
                    onPick(d, d === a ? b : a);
                  }}
                >
                  Keep this one
                </button>
              ) : null}
            </div>
          ))}
          <p className="quiet think-disagree-note">
            The one not kept is dropped. History keeps both.
          </p>
        </div>
      ))}
    </>
  );
}
