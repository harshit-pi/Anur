import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SectionNode, SectionTree } from "@anur/core";
import type {
  AgentSignIn,
  SessionOption,
  AgentStatus,
  EventPayload,
  ThreadItem,
  ThreadView,
  PreviewView,
} from "../../../shared/ipc-contract.ts";
import { AGENTS, AGENT_IDS, type AgentId } from "../../../shared/agents.ts";
import { anur } from "../bridge.ts";
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
  const textNow = useRef(docText);
  textNow.current = docText;

  useEffect(() => {
    setThreads([]);
    setPrompts([]);
    if (!docPath) return;
    let current = true;
    void anur.call("thread:list", { path: docPath, text: textNow.current() }).then((r) => {
      if (current) setThreads(r.threads);
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
  }, [docPath]);

  return { threads, setThreads, prompts, setPrompts };
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
  let kind: "heading" | "list" | "text" | null = null;
  for (const line of block.split("\n")) {
    const next: "heading" | "list" | "text" = /^#{1,6}\s/.test(line)
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
  tokens: { used: number; context: number; first: number; window: number | null };
  onStartFresh: () => void;
}) {
  const share = tokens.window ? Math.min(1, tokens.context / tokens.window) : null;
  const grown = tokens.window ? (tokens.context - tokens.first) / tokens.window : 0;
  return (
    <div className="think-meter" title="From the agent's usage reports">
      <div className="think-meter-line quiet">
        <span>{formatTokens(tokens.used)} tokens used</span>
        {share !== null && tokens.window ? (
          <span>
            context {String(Math.round(share * 100))}% of {formatTokens(tokens.window)}
          </span>
        ) : null}
      </div>
      {share !== null ? (
        <div className="think-meter-bar" aria-hidden="true">
          <i
            style={{ width: `${String(Math.round(share * 100))}%` }}
            className={grown > START_FRESH_AT ? "full" : ""}
          />
        </div>
      ) : null}
      {grown > START_FRESH_AT ? (
        <p className="think-meter-note">
          This thread has grown long, and an agent reasons less well late in a long context.{" "}
          <button type="button" className="think-more" onClick={onStartFresh}>
            Start fresh
          </button>{" "}
          from the section's text.
        </p>
      ) : null}
    </div>
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
  return (
    <div
      className="think-offer edit"
      role="group"
      aria-label={`Proposed edit to ${part.path.at(-1) ?? ""}`}
    >
      <div className="think-offer-head">
        <strong>Edit to {part.path.at(-1)}</strong>
        <span className="quiet">Not in the doc yet</span>
      </div>
      <div className="think-offer-text">
        {body ? <Markdown text={body} /> : <p className="quiet">Removes the section's text.</p>}
      </div>
      <div className="think-offer-actions">
        {writable ? (
          <button type="button" className="think-button primary" onClick={onUse}>
            Use this
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

function Composer({
  placeholder,
  busy,
  disabled,
  onSend,
  onStop,
  sendLabel,
  pickers,
}: {
  placeholder: string;
  busy: boolean;
  disabled: boolean;
  onSend: (text: string) => Promise<boolean>;
  onStop?: () => void;
  sendLabel: string;
  /** Agent, mode and model, on the send button's line, as in the Claude app. */
  pickers?: React.ReactNode;
}) {
  const [text, setText] = useState("");
  const send = () => {
    const t = text.trim();
    if (!t || busy || disabled) return;
    void onSend(t).then((ok) => {
      if (ok) setText("");
    });
  };
  return (
    <div className="think-composer">
      <textarea
        className="think-input"
        placeholder={placeholder}
        aria-label={placeholder}
        value={text}
        rows={2}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
      />
      <div className="think-composer-foot">
        <div className="think-pickers">{pickers}</div>
        {busy && onStop ? (
          <button type="button" className="think-button" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="think-send"
            aria-label={sendLabel}
            title={`${sendLabel} (Enter)`}
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
}: {
  /** The page's own view: the section's text is edited here through it. */
  page: () => EditorView | null;
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
  const { threads, setThreads, prompts, setPrompts } = useThreads(docPath, docText);
  const [open, setOpen] = useState<string | null>(null);
  /** Each agent's connection, as main last reported it. */
  const [statuses, setStatuses] = useState<Partial<Record<AgentId, AgentStatus>>>({});
  const noteStatus = useCallback((s: AgentStatus) => {
    setStatuses((all) => ({ ...all, [s.id]: s }));
  }, []);
  /** The agent a new thread runs on: the default from settings, unless picked here. */
  const [newAgent, setNewAgent] = useState<AgentId>("claude-code");
  /** A new thread's mode and model: the agent's choices, as last seen, with the person's picks. */
  const [newChoices, setNewChoices] = useState<SessionOption[]>([]);
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
    void anur.call("settings:get", {}).then((s) => {
      setNewAgent(s.defaultAgent);
    });
    void anur.call("agent:status", { connect: false }).then(noteStatus);
    return anur.on("agent:status", noteStatus);
  }, [noteStatus]);

  const here = useMemo(
    () => (section ? threads.filter((t) => samePath(t.path, section.path)) : []),
    [threads, section],
  );
  /** Every other thread in the doc, in the order of their sections, the latest first within one. */
  const elsewhere = useMemo(() => {
    const order = new Map(tree?.sections.map((s, i) => [s.path.join("\u0000"), i]));
    const at = (t: ThreadView) => (t.path ? (order.get(t.path.join("\u0000")) ?? 1e9) : 1e9);
    return threads.filter((t) => !here.includes(t)).sort((a, b) => at(a) - at(b));
  }, [threads, here, tree]);
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
  const thread = threads.find((t) => t.id === open) ?? null;
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
  const [inputs, setInputs] = useState<
    { id: string; thread: string; source: string; label: string; trust: string }[]
  >([]);
  const threadsSeen = threads.map((t) => `${t.id}:${String(t.items.length)}`).join(",");
  useEffect(() => {
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
    if (thread && section && !samePath(thread.path, section.path) && !thread.busy) setOpen(null);
  }, [sectionKey, section, thread]);

  const start = useCallback(
    async (message: string, purpose?: "build" | "check") => {
      if (!docPath || !section) return false;
      setError(null);
      // An action plans first (15.2): the agent's plan mode, where it has one.
      const options = newChoices.map((o) => ({
        id: o.id,
        value: purpose && o.choices.some((c) => c.value === "plan") ? "plan" : o.current,
      }));
      const r = await anur.call("thread:start", {
        path: docPath,
        text: docText(),
        section: { index: section.index, path: section.path },
        message,
        agent: newAgent,
        options,
        ...(purpose ? { purpose } : {}),
      });
      if (r.kind === "refused") {
        setError(r.reason);
        return false;
      }
      setThreads((ts) => [...ts.filter((t) => t.id !== r.thread.id), r.thread]);
      setOpen(r.thread.id);
      return true;
    },
    [docPath, section, docText, setThreads, newAgent, newChoices],
  );

  /** A picked option goes into the page, where ⌘Z takes it back; the thread remembers the pick. */
  const useOption = (
    t: ThreadView,
    option: { id: string; title: string; text: string },
    how: "replace" | "subsection",
  ) => {
    const main = page();
    const node = tree?.sections.find((x) => t.path && samePath(t.path, x.path));
    if (!main || !docPath || !node) {
      setError("This thread's section is gone, so the option has nowhere to go.");
      return;
    }
    if (!putOption(main, docPath.split("/").pop() ?? docPath, node, option, how)) {
      setError("This thread's section is gone, so the option has nowhere to go.");
      return;
    }
    void anur.call("thread:use-option", {
      thread: t.id,
      path: docPath,
      text: main.state.doc.toString(),
      option: option.id,
      how,
    });
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
    return (
      <div className="think">
        <button
          type="button"
          className="think-back"
          onClick={() => {
            setOpen(null);
          }}
        >
          ← All threads
        </button>
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
            On {thread.path.at(-1)}
          </button>
        ) : (
          <span className="think-where quiet">Its section is gone</span>
        )}
        <h2
          className="think-title"
          // Click to rename: the name shows here, in the list and on the map.
          contentEditable={writable ? "plaintext-only" : false}
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
        <div className="think-chat" aria-live="polite">
          {thread.items.map((item, i) =>
            item.kind === "message" ? (
              <div key={i} className={`think-message ${item.role}`}>
                {item.role === "agent" ? <Markdown text={item.text} /> : item.text}
              </div>
            ) : item.kind === "tool" ? (
              <div key={i} className={`think-tool ${item.status}`} title={item.title}>
                {toolLabel(item.title)}
              </div>
            ) : item.kind === "options" ? (
              <div key={i} className="think-offers" role="group" aria-label="Options">
                {item.within ? (
                  <p className="think-offers-within quiet">
                    Within{" "}
                    {thread.items
                      .flatMap((x) => (x.kind === "options" ? x.options : []))
                      .find((o) => o.id === item.within)?.title ?? "an earlier option"}
                  </p>
                ) : null}
                {item.options.map((o) => (
                  <div
                    key={o.id}
                    className={`think-offer${item.used === o.id ? " used" : item.explored.includes(o.id) ? " explored" : ""}`}
                  >
                    <div className="think-offer-head">
                      <strong>{o.title}</strong>
                      {item.used === o.id ? (
                        <span className="quiet">In the doc</span>
                      ) : item.explored.includes(o.id) ? (
                        <span className="quiet">Explored</span>
                      ) : null}
                    </div>
                    <div className="think-offer-text">
                      <Markdown text={o.text} />
                    </div>
                    {writable && item.used !== o.id ? (
                      <div className="think-offer-actions">
                        <button
                          type="button"
                          className="think-button primary"
                          onClick={() => {
                            useOption(thread, o, "replace");
                          }}
                        >
                          Use this
                        </button>
                        <button
                          type="button"
                          className="think-more"
                          onClick={() => {
                            useOption(thread, o, "subsection");
                          }}
                        >
                          Add as subsection
                        </button>
                        {item.explored.includes(o.id) ? null : (
                          <button
                            type="button"
                            className="think-more"
                            disabled={thread.busy}
                            onClick={() => {
                              setError(null);
                              void anur
                                .call("thread:explore-option", {
                                  thread: thread.id,
                                  path: docPath,
                                  text: docText(),
                                  option: o.id,
                                })
                                .then((r) => {
                                  if (r.kind === "refused") setError(r.reason);
                                });
                            }}
                          >
                            Explore this
                          </button>
                        )}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : item.kind === "auto-used" ? (
              <div key={i} className="think-changed auto" role="status">
                <span>
                  {item.undone ? "Taken back: " : "Used as it landed: "}
                  the edit to <strong>{item.sections.map((p) => p.at(-1) ?? "").join(", ")}</strong>
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
            ) : item.kind === "changed" ? (
              <div key={i} className="think-changed" role="status">
                <span>
                  <strong>{item.path}</strong>{" "}
                  {item.reverted
                    ? "changed while this thread was running, and was reverted."
                    : "changed while this thread was running, by something other than Anur."}
                </span>
                {item.canRevert ? (
                  <button
                    type="button"
                    className="think-button"
                    onClick={() => {
                      void anur
                        .call("thread:revert", { thread: thread.id, id: item.id })
                        .then((r) => {
                          if (r.kind === "refused") setError(r.reason);
                        });
                    }}
                  >
                    Revert
                  </button>
                ) : null}
              </div>
            ) : item.kind === "check" ? (
              <CheckCard key={i} claims={item.claims} corrected={item.corrected} />
            ) : item.kind === "created" ? (
              <div key={i} className="think-changed auto" role="status">
                <span>
                  {item.undoable ? "Made " : "Made, then taken back: "}
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
            ) : (
              <div key={i} className="think-error" role="alert">
                {item.text}
              </div>
            ),
          )}
          {thread.busy && thread.items.at(-1)?.kind !== "message" && asks.length === 0 ? (
            <div className="think-working quiet">Thinking…</div>
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
        {thread.items.length > 0 && thread.options.length === 0 && !thread.busy ? (
          <p className="quiet think-agent-note">
            The next message starts on {AGENTS[thread.agent].name}, from this section's text and the
            chat so far.
          </p>
        ) : null}
        {signedOut(thread.agent) ?? (
          <Composer
            placeholder="Reply in this thread"
            sendLabel="Send"
            pickers={
              <>
                <AgentPicker
                  value={thread.agent}
                  disabled={thread.busy}
                  onChange={(next) => {
                    setThreads((ts) =>
                      ts.map((t) => (t.id === thread.id ? { ...t, agent: next, options: [] } : t)),
                    );
                    void anur.call("thread:agent", { thread: thread.id, agent: next });
                  }}
                />
                {thread.options.map((o) => (
                  <label key={o.id} className="think-option">
                    <span className="quiet">{o.name}</span>
                    <select
                      aria-label={o.name}
                      value={o.current}
                      disabled={thread.busy}
                      title={o.choices.find((c) => c.value === o.current)?.description ?? undefined}
                      onChange={(e) => {
                        const value = e.target.value;
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
                    >
                      {o.choices.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </>
            }
            busy={thread.busy}
            disabled={!writable || thread.path === null}
            onStop={() => {
              void anur.call("thread:stop", { thread: thread.id });
            }}
            onSend={async (message) => {
              setError(null);
              const r = await anur.call("thread:send", {
                thread: thread.id,
                path: docPath,
                text: docText(),
                message,
              });
              if (r.kind === "refused") {
                setError(r.reason);
                return false;
              }
              setThreads((ts) =>
                ts.map((t) =>
                  t.id === thread.id
                    ? {
                        ...t,
                        busy: true,
                        items: [
                          ...t.items,
                          { kind: "message", turn: "", role: "person", text: message },
                        ],
                      }
                    : t,
                ),
              );
              return true;
            }}
          />
        )}
      </div>
    );
  }

  const body = bodyOf(docText(), section);
  return (
    <div className="think">
      <h2
        className="think-section"
        // The heading is the section's name: edit it here as on the page.
        contentEditable={writable && section.headingRange ? "plaintext-only" : false}
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
      {inputs.length > 0 ? (
        <details className="think-inputs">
          <summary className="think-subhead">Inputs ({String(inputs.length)})</summary>
          <p className="quiet think-inputs-note">
            Earlier threads picked these up; new threads here and below can read them.
          </p>
          <ul>
            {inputs.map((i) => (
              <li key={i.id}>
                <span className="think-input-source">{i.source}</span>
                <span className="truncate" title={i.label}>
                  {i.label}
                </span>
                {i.trust === "untrusted" ? <span className="quiet">untrusted</span> : null}
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
      {here.length === 0 ? (
        <h3 className="think-subhead">No threads on this section yet</h3>
      ) : (
        <GroupedThreads threads={here} stateOf={stateOf} onOpen={setOpen} />
      )}
      {notConnected(newAgent)}
      {error ? <p className="think-error">{error}</p> : null}
      {signedOut(newAgent) ?? (
        <Composer
          placeholder={
            !writable
              ? "Threads need a folder Anur can write to"
              : section.index === 0
                ? "What should we do with this doc?"
                : "What should we do with this section?"
          }
          sendLabel="Start thread"
          pickers={
            <>
              <AgentPicker value={newAgent} disabled={!writable} onChange={setNewAgent} />
              {newChoices.map((o) => (
                <OptionPicker
                  key={o.id}
                  option={o}
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
      )}
      {writable && AGENTS[newAgent].runsThreads && !signedOut(newAgent) ? (
        <div className="think-actions" role="group" aria-label="Actions">
          <button
            type="button"
            className="think-more"
            title="The agent plans the work this section describes, and builds it once you approve"
            onClick={() => {
              void start("-", "build");
            }}
          >
            Build this section
          </button>
          <button
            type="button"
            className="think-more"
            title="The agent tests each claim here against what the section links or names, changing nothing"
            onClick={() => {
              void start("-", "check");
            }}
          >
            Check this section
          </button>
        </div>
      ) : null}
      {elsewhere.length > 0 ? (
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
    </div>
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
}: {
  claims: {
    claim: string;
    verdict: keyof typeof VERDICT;
    source: string;
    note: string;
  }[];
  corrected: boolean;
}) {
  const counts = (["wrong", "missing", "unsupported", "holds"] as const)
    .map((v) => [v, claims.filter((c) => c.verdict === v).length] as const)
    .filter(([, n]) => n > 0)
    .map(([v, n]) => `${String(n)} ${v === "holds" ? "hold" : v}`);
  return (
    <div className="think-check" role="group" aria-label="Check">
      <p className="think-check-head">
        <strong>
          {claims.every((c) => c.verdict === "holds")
            ? `All ${countOf(claims.length, "claim")} hold`
            : counts.join(", ")}
        </strong>
        {corrected ? <span className="quiet"> · a corrected version is below</span> : null}
      </p>
      <ul>
        {claims.map((c, i) => (
          <li key={i} className={`think-claim ${c.verdict}`}>
            <span className="think-verdict">{VERDICT[c.verdict]}</span>
            <div>
              <div>{c.claim}</div>
              <div className="quiet">
                {c.note} <span className="think-source">{c.source}</span>
              </div>
            </div>
          </li>
        ))}
      </ul>
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

/** Which agent a thread runs on. Agents that can't run threads yet are listed, and say why. */
function AgentPicker({
  value,
  disabled,
  onChange,
}: {
  value: AgentId;
  disabled: boolean;
  onChange: (agent: AgentId) => void;
}) {
  return (
    <label className="think-option">
      <span className="think-pick">{AGENTS[value].name}</span>
      <select
        aria-label="Agent"
        value={value}
        disabled={disabled}
        title={AGENTS[value].why ?? undefined}
        onChange={(e) => {
          const next = AGENT_IDS.find((id) => id === e.target.value);
          if (next) onChange(next);
        }}
      >
        {AGENT_IDS.map((id) => (
          <option key={id} value={id} disabled={!AGENTS[id].runsThreads}>
            {AGENTS[id].runsThreads ? AGENTS[id].name : `${AGENTS[id].name} (not yet)`}
          </option>
        ))}
      </select>
    </label>
  );
}

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
  const of = (s: ThreadState) => threads.filter((t) => stateOf(t) === s);
  const needs = of("needs-you");
  const running = of("running");
  const done = of("done");
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
      {running.length > 0 ? (
        <>
          <h3 className="think-subhead">Running ({String(running.length)})</h3>
          <ThreadList threads={running} onOpen={onOpen} />
        </>
      ) : null}
      {done.length > 0 ? (
        <details className="think-done" open={needs.length === 0 && running.length === 0}>
          <summary className="think-subhead">Done ({String(done.length)})</summary>
          <ThreadList threads={done} onOpen={onOpen} />
        </details>
      ) : null}
    </div>
  );
}

/** Threads as buttons: their question, where they are, and how far they've got. */
/** Anur's own tools, named for the person rather than by their ids. */
const OWN_TOOLS: Record<string, string> = {
  anur_name_thread: "Named the thread",
  anur_list_inputs: "Looked at the section's inputs",
  anur_read_input: "Read an input",
  anur_report_check: "Reported the check",
  anur_offer_options: "Offered options",
  anur_read_section: "Read a section",
};

function toolLabel(title: string): string {
  if (title === "Approve Plan") return "Asked you to approve the plan";
  if (/^Write \S*\/\.claude\/plans\//.test(title)) return "Wrote the plan";
  const own = /^mcp__anur__(\w+)/.exec(title)?.[1];
  return own ? (OWN_TOOLS[own] ?? own.replace(/^anur_/, "").replace(/_/g, " ")) : title;
}

const PURPOSE = { build: "Build", check: "Check" } as const;

/** A thread's title, tagged Build or Check when it's an action (15.7). */
export function ThreadName({ thread }: { thread: ThreadView }) {
  if (!thread.purpose) return <>{thread.title}</>;
  const tag = PURPOSE[thread.purpose];
  const title = thread.title.startsWith(`${tag}: `)
    ? thread.title.slice(tag.length + 2)
    : thread.title;
  return (
    <>
      <span className="thread-tag">{tag}</span>
      {title}
    </>
  );
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
            className="think-thread"
            onClick={() => {
              onOpen(t.id);
            }}
          >
            {showSection ? (
              <span className="think-thread-where">
                {t.path ? t.path.at(-1) : "A section that's gone"}
              </span>
            ) : null}
            <span className="think-thread-title">
              <ThreadName thread={t} />
            </span>
            <span className="quiet">
              {t.busy
                ? "Replying…"
                : `${countOf(t.items.filter((i) => i.kind === "message").length, "message")}${
                    t.tokens ? `, ${formatTokens(t.tokens.used)} tokens` : ""
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
}: {
  option: SessionOption;
  disabled: boolean;
  onChange: (value: string) => void;
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
          onChange(e.target.value);
        }}
      >
        {option.choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.name}
          </option>
        ))}
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
