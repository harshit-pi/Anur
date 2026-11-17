import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SectionNode, SectionTree } from "@anur/core";
import type {
  AgentSignIn,
  SessionOption,
  AgentStatus,
  EventPayload,
  ThreadItem,
  ThreadView,
} from "../../../shared/ipc-contract.ts";
import { AGENTS, AGENT_IDS, type AgentId } from "../../../shared/agents.ts";
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
  onJump,
}: {
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
        agent: newAgent,
        options: newChoices.map((o) => ({ id: o.id, value: o.current })),
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
        {notConnected(thread.agent)}
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
        <div className="think-options">
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
      <ThreadList threads={here} onOpen={setOpen} />
      {notConnected(newAgent)}
      {error ? <p className="think-error">{error}</p> : null}
      <div className="think-options">
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
      </div>
      {signedOut(newAgent) ?? (
        <Composer
          placeholder={
            writable ? "Ask about this section" : "Threads need a folder Anur can write to"
          }
          sendLabel="Start thread"
          busy={false}
          disabled={!writable || !AGENTS[newAgent].runsThreads}
          onSend={start}
        />
      )}
      {elsewhere.length > 0 ? (
        <>
          <h3 className="think-subhead">Other threads in this doc ({String(elsewhere.length)})</h3>
          <ThreadList threads={elsewhere} onOpen={setOpen} showSection />
        </>
      ) : null}
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
      <span className="quiet">Agent</span>
      <select
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

/** Threads as buttons: their question, where they are, and how far they've got. */
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
      <span className="quiet">{option.name}</span>
      <select
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
