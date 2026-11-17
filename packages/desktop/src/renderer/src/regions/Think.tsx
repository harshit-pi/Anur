import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SectionNode, SectionTree } from "@anur/core";
import type {
  AgentStatus,
  EventPayload,
  ThreadItem,
  ThreadView,
} from "../../../shared/ipc-contract.ts";
import { anur } from "../bridge.ts";
import { inlineRuns } from "../layout/inline-markdown.ts";

/**
 * The Think panel (task 3.5): the section the cursor is in, its text as it
 * stands, and its threads. Each thread is its own chat with the person's
 * agent, started from this section; what the agent reads is listed above
 * the chat, so what is shown is exactly what is sent.
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
function bodyOf(text: string, s: SectionNode): string {
  const from = s.headingRange ? s.headingRange.to : s.ownRange.from;
  return text.slice(from, s.ownRange.to).trim();
}

/** Light Markdown for a reply: paragraphs, bullets and inline styles. */
function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, b) => {
        const lines = block.split("\n");
        const bullets = lines.every((l) => /^\s*(?:[-*+]|\d+[.)])\s/.test(l) || l.trim() === "");
        const render = (line: string, i: number) => (
          <span key={i}>
            {inlineRuns(line).map((r, j) => (
              <span key={j} className={r.marks.map((m) => `md-${m}`).join(" ") || undefined}>
                {r.text}
              </span>
            ))}
          </span>
        );
        if (bullets)
          return (
            <ul key={b} className="think-list">
              {lines
                .filter((l) => l.trim())
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

function Composer({
  placeholder,
  busy,
  disabled,
  onSend,
  onStop,
  sendLabel,
}: {
  placeholder: string;
  busy: boolean;
  disabled: boolean;
  onSend: (text: string) => Promise<boolean>;
  onStop?: () => void;
  sendLabel: string;
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
      {busy && onStop ? (
        <button type="button" className="think-button" onClick={onStop}>
          Stop
        </button>
      ) : (
        <button
          type="button"
          className="think-button primary"
          disabled={disabled || text.trim() === ""}
          onClick={send}
        >
          {sendLabel}
        </button>
      )}
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
}: {
  docPath: string | null;
  docText: () => string;
  tree: SectionTree | null;
  section: SectionNode | null;
  writable: boolean;
  /** A thread to open now, as "Keep discussing" on a preview asks. */
  request: { thread: string; n: number } | null;
}) {
  const { threads, setThreads, prompts, setPrompts } = useThreads(docPath, docText);
  const [open, setOpen] = useState<string | null>(null);
  const [agent, setAgent] = useState<AgentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showText, setShowText] = useState(false);
  /** Threads with a preview of this doc, for "Preview in doc". */
  const [previewed, setPreviewed] = useState<Set<string>>(new Set());
  const textNow = useRef(docText);
  textNow.current = docText;

  useEffect(() => {
    setPreviewed(new Set());
    if (!docPath) return;
    let current = true;
    const load = () => {
      void anur.call("preview:list", { path: docPath, text: textNow.current() }).then((r) => {
        if (current) setPreviewed(new Set(r.previews.map((p) => p.thread)));
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
    void anur.call("agent:status", { connect: false }).then(setAgent);
    return anur.on("agent:status", setAgent);
  }, []);

  const here = useMemo(
    () => (section ? threads.filter((t) => samePath(t.path, section.path)) : []),
    [threads, section],
  );
  const thread = threads.find((t) => t.id === open) ?? null;

  // "Keep discussing" on a preview: open that thread, wherever the cursor is.
  useEffect(() => {
    if (!request || request.n <= handledRequest) return;
    handledRequest = request.n;
    setOpen(request.thread);
  }, [request]);

  // Moving the cursor to another section shows its threads, unless the open
  // thread is still running. Opening a thread from elsewhere doesn't close it.
  const sectionKey = section?.path.join("\u0000") ?? null;
  const lastSection = useRef(sectionKey);
  useEffect(() => {
    if (lastSection.current === sectionKey) return;
    lastSection.current = sectionKey;
    if (thread && section && !samePath(thread.path, section.path) && !thread.busy) setOpen(null);
  }, [sectionKey, section, thread]);

  const start = useCallback(
    async (message: string) => {
      if (!docPath || !section) return false;
      setError(null);
      const r = await anur.call("thread:start", {
        path: docPath,
        text: docText(),
        section: { index: section.index, path: section.path },
        message,
      });
      if (r.kind === "refused") {
        setError(r.reason);
        return false;
      }
      setThreads((ts) => [...ts.filter((t) => t.id !== r.thread.id), r.thread]);
      setOpen(r.thread.id);
      return true;
    },
    [docPath, section, docText, setThreads],
  );

  if (!docPath || !tree)
    return <p className="quiet">Threads on the section you're in show here.</p>;
  if (!section) return <p className="quiet">Put the cursor in a section to think about it.</p>;

  const notConnected =
    agent?.connected === false ? (
      <div className="think-banner" role="status">
        <p>{agent.reason ?? "The agent isn't connected."}</p>
        <button
          type="button"
          className="think-button"
          onClick={() => {
            void anur.call("agent:status", { connect: true }).then(setAgent);
          }}
        >
          Try again
        </button>
      </div>
    ) : null;

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
          ← Threads on {thread.path?.at(-1) ?? "a removed section"}
        </button>
        <h2 className="think-title">{thread.title}</h2>
        <section className="think-reads" aria-label="The agent reads in this thread">
          <h3>The agent reads in this thread</h3>
          {thread.reads.map((r) => (
            <div key={`${r.label}:${r.detail}`} className="think-read">
              <span className="truncate">{r.label}</span>
              <span className="quiet">{r.detail}</span>
            </div>
          ))}
          <div className="think-read left-out">
            <span>Other threads, on any section</span>
            <span>left out</span>
          </div>
        </section>
        <div className="think-chat" aria-live="polite">
          {thread.items.map((item, i) =>
            item.kind === "message" ? (
              <div key={i} className={`think-message ${item.role}`}>
                {item.role === "agent" ? <Markdown text={item.text} /> : item.text}
              </div>
            ) : item.kind === "tool" ? (
              <div key={i} className={`think-tool ${item.status}`} title={item.status}>
                {item.title}
              </div>
            ) : (
              <div key={i} className="think-error" role="alert">
                {item.text}
              </div>
            ),
          )}
          {thread.busy && thread.items.at(-1)?.kind !== "message" ? (
            <div className="think-working quiet">Thinking…</div>
          ) : null}
          {asks.map((p) => (
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
          ))}
        </div>
        {notConnected}
        {error ? <p className="think-error">{error}</p> : null}
        {previewed.has(thread.id) && !thread.busy ? (
          <button
            type="button"
            className="think-button primary think-preview"
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent("anur:show-preview", { detail: { thread: thread.id } }),
              );
            }}
          >
            Preview in doc
          </button>
        ) : null}
        {thread.options.length > 0 ? (
          <div className="think-options">
            {thread.options.map((o) => (
              <label key={o.id} className="think-option">
                <span className="quiet">{o.name}</span>
                <select
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
          </div>
        ) : null}
        <Composer
          placeholder="Reply in this thread"
          sendLabel="Send"
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
      </div>
    );
  }

  const body = bodyOf(docText(), section);
  return (
    <div className="think">
      <h2 className="think-section">{section.path.at(-1)}</h2>
      <div className={`think-text${showText ? " open" : ""}`}>
        {body ? <Markdown text={body} /> : <p className="quiet">No text yet.</p>}
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
      <h3 className="think-subhead">
        {here.length === 0 ? "No threads on this section yet" : `Threads (${String(here.length)})`}
      </h3>
      <ul className="think-threads">
        {here.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              className="think-thread"
              onClick={() => {
                setOpen(t.id);
              }}
            >
              <span className="think-thread-title">{t.title}</span>
              <span className="quiet">
                {t.busy
                  ? "Replying…"
                  : countOf(t.items.filter((i) => i.kind === "message").length, "message")}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {notConnected}
      {error ? <p className="think-error">{error}</p> : null}
      <Composer
        placeholder={
          writable ? "Ask about this section" : "Threads need a folder Anur can write to"
        }
        sendLabel="Start thread"
        busy={false}
        disabled={!writable}
        onSend={start}
      />
    </div>
  );
}
