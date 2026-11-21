import { ServiceIcon, serviceOf } from "../icons/services/index.tsx";
import { editsLand } from "../../../shared/edits-land.ts";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { choicePress } from "../layout/map-acts.ts";
import { FOLDER_DOC, samePath, type SectionNode, type SectionTree } from "@anur/core";
import { RecentThreads, ScopeChip, type ScopeChoice } from "./ThinkScope.tsx";
import type {
  AgentSignIn,
  SessionOption,
  AgentStatus,
  ThreadItem,
  ThreadView,
  PreviewView,
} from "../../../shared/ipc-contract.ts";
import { AGENTS, runsThreads, type AgentId } from "../../../shared/agents.ts";
import { anur } from "../bridge.ts";
import { mergeLanded } from "../layout/landed-notes.ts";
import {
  advance,
  planQueue,
  plannedOn,
  queued as inPlan,
  usePlanQueue,
  type Step,
} from "./plan-queue.ts";
import { landedUndo } from "../editor/landed-undo.ts";
import { AgentMark } from "./AgentMark.tsx";
import { useFeatures } from "../features.ts";
import { formatTokens } from "../layout/tokens.ts";
import { SectionEditor } from "../editor/section-editor.tsx";
import type { ClickedLink } from "../editor/link-click.ts";
import { putOption, renameSection } from "../editor/section-range.ts";
import type { EditorView } from "@codemirror/view";
import { actionWaits } from "./action-waits.ts";
import { bodyOf, Markdown } from "./Markdown.tsx";
import { sentWhen } from "./thread-time.ts";
import { exploresPath, foldSteps, runningStep, toolLabel } from "./thread-steps.ts";
import { countOf, Icon, type Attachment, type Queued, openFile, FileCard } from "./think-parts.tsx";
import { SectionHistory, ChangeSet } from "./SectionHistory.tsx";
import { CheckCard, FindingCard, PlanCard } from "./ThinkCards.tsx";
import { Composer } from "./Composer.tsx";
import { type ThreadState, GroupedThreads, ThreadList } from "./ThreadList.tsx";
import { Orphans } from "./Orphans.tsx";
import {
  turnAgent,
  openAgents,
  AgentPicker,
  withPicks,
  OptionPicker,
  SignInCard,
} from "./AgentPicker.tsx";
import { Working, whoLabel, AgentReply, StepsFold } from "./AgentReply.tsx";
import { useThreads } from "./useThreads.ts";
import { Disagreements } from "./Disagreements.tsx";
import { OfferText, EditCard, ChangeRow } from "./OfferRows.tsx";

/**
 * The Think panel (task 3.5): the section the cursor is in, its text as it
 * stands, and its threads. Each thread is its own chat with the person's
 * agent, started from this section. What the agent reads isn't listed:
 * it was more than a thread needs on screen.
 */

/** The last open-thread request acted on: Think remounts with the tab, and a request opens once. */
let handledRequest = 0;

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

/** Rows dragged from the files panel carry their full paths under this type (see FileTree). */
const PANEL_PATHS = "application/x-anur-files";

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

export function Think({
  docPath,
  docText,
  tree,
  section,
  writable,
  request,
  onJump,
  page,
  onOpenLink,
  notify,
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
  /** Opens a link clicked in the section's text, as on the page. */
  onOpenLink: (link: ClickedLink, inNewTab: boolean) => void;
  /** Says a problem with an edit there, such as an image that couldn't be added. */
  notify: (message: string) => void;
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
    if (!runsThreads(agent)) return;
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
  // The status bar names the agent being worked with here, not only the default.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("anur:agent-shown", { detail: { agent: shownAgent } }));
  }, [shownAgent]);
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
  // Picking another box on the map, or moving the cursor on the page, keeps the open
  // thread: you leave it with ←, or start one from a section's hover card on the map (30.37).

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
  /** Actions started here: a second Run before the first shows as run doesn't start another. */
  const started = useRef(new Set<string>());
  const runAction = useCallback(
    async (
      from: ThreadView,
      a: { id: string; what: string; path: readonly string[] | null },
    ): Promise<boolean> => {
      const target = a.path ?? from.path;
      const node = tree?.sections.find((x) => target && samePath(target, x.path));
      if (!docPath || !node) {
        setError("That action's section is gone.");
        return false;
      }
      const key = `${from.id}:${a.id}`;
      if (started.current.has(key)) return true;
      started.current.add(key);
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
        started.current.delete(key);
        setError(r.reason);
        return false;
      }
      // The Build runs beside you: the thread you ran it from stays open, and
      // its action opens the Build when you want it.
      setThreads((ts) => [...ts.filter((t) => t.id !== r.thread.id), r.thread]);
      return true;
    },
    [tree, docPath, docText, newAgent, newChoices, setThreads],
  );
  // A plan run in order: each next action starts once the one before is done.
  const queue = usePlanQueue();
  useEffect(() => {
    if (queue.length === 0) return;
    const next = advance(queue, threads);
    if (next.queue !== queue) planQueue.set(next.queue);
    const step = next.run;
    if (!step) return;
    const from = threads.find((t) => t.id === step.thread);
    const a = from?.items.find((x) => x.kind === "proposed-action" && x.id === step.action);
    if (!from || a?.kind !== "proposed-action") return;
    // A refusal (the session limit, a gone section) ends the plan; its reason shows.
    void runAction(from, a).then((ok) => {
      if (!ok) planQueue.set([]);
    });
  }, [queue, threads, runAction]);
  /** Build this section: a section with planned actions runs them in order; else a Build as before. */
  const build = useCallback(
    (on?: { index: number; path: string[] }) => {
      const at = on ?? section;
      const plan = at ? plannedOn(threads, at.path) : [];
      if (plan.length > 0) planQueue.set(plan);
      else void start("-", "build", undefined, on);
    },
    [section, threads, start],
  );

  // Start a new thread pressed in a section's hover card on the map (30.37): the map selected it; its box to type in is ready.
  useEffect(() => {
    const on = () => {
      setOpen(null);
      requestAnimationFrame(() => {
        document.querySelector<HTMLTextAreaElement>(".think .think-input")?.focus();
      });
    };
    window.addEventListener("anur:map-new-thread", on);
    return () => {
      window.removeEventListener("anur:map-new-thread", on);
    };
  }, []);
  // Build or Check pressed on a section's box on the map (30.32): the same as the links here.
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ index: number; path: string[]; purpose: "build" | "check" }>)
        .detail;
      const node = tree?.sections[d.index];
      if (!node || !samePath(node.path, d.path)) return;
      const at = { index: node.index, path: node.path };
      if (d.purpose === "build") build(at);
      else void start("-", d.purpose, undefined, at);
    };
    window.addEventListener("anur:map-section-action", on);
    return () => {
      window.removeEventListener("anur:map-section-action", on);
    };
  }, [tree, start, build]);

  // ▶ Run pressed on a planned box on the map.
  useEffect(() => {
    const onRun = (e: Event) => {
      const { thread, action } = (e as CustomEvent<{ thread: string; action: string }>).detail;
      const from = threads.find((t) => t.id === thread);
      const a = from?.items.find((x) => x.kind === "proposed-action" && x.id === action);
      if (from && a?.kind === "proposed-action" && !a.run && !actionWaits(threads, from, a.id))
        void runAction(from, a);
    };
    // Run all on a "▶ N planned" group: the whole plan, in order (plan-queue.ts).
    const onRunAll = (e: Event) => {
      planQueue.set((e as CustomEvent<Step[]>).detail);
    };
    window.addEventListener("anur:run-action", onRun);
    window.addEventListener("anur:run-actions", onRunAll);
    return () => {
      window.removeEventListener("anur:run-action", onRun);
      window.removeEventListener("anur:run-actions", onRunAll);
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
    if (!runsThreads(id))
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
    const folded = foldSteps(mergeLanded(thread.items), thread.busy);
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
                // The agent that ran this turn, which may not be the one the thread is on now.
                <div
                  className="think-who"
                  title={whoLabel(turnAgent(thread, item), thread.options)}
                >
                  <AgentMark agent={turnAgent(thread, item)} />
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
                        className={`think-offer${item.used === o.id || item.added.includes(o.id) ? " used" : item.explored.includes(o.id) ? " explored" : ""}${openOffers.has(o.id) ? "" : " compact"}`}
                      >
                        <div className="think-offer-head">
                          {/* One line until its name is clicked: the full text is on its map box too (30.44). */}
                          <button
                            type="button"
                            className="think-offer-name"
                            aria-expanded={openOffers.has(o.id)}
                            title={openOffers.has(o.id) ? "Show less" : "Show all"}
                            onClick={() => {
                              setOpenOffers((cur) => {
                                const next = new Set(cur);
                                if (!next.delete(o.id)) next.add(o.id);
                                return next;
                              });
                            }}
                          >
                            {o.title}
                          </button>
                          {item.used === o.id || item.added.includes(o.id) ? (
                            <span className="quiet">In the doc</span>
                          ) : item.explored.includes(o.id) ? (
                            <span className="quiet">Explored</span>
                          ) : null}
                        </div>
                        {openOffers.has(o.id) ? (
                          <OfferText
                            open
                            onToggle={() => {
                              setOpenOffers((cur) => {
                                const next = new Set(cur);
                                next.delete(o.id);
                                return next;
                              });
                            }}
                          >
                            <Markdown text={o.text} />
                          </OfferText>
                        ) : null}
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
                // One line per page changed: the reply already says what changed.
                <ChangeRow
                  key={i}
                  doc={item.doc}
                  sections={item.sections}
                  state={item.undone ? "taken back" : null}
                >
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
                  ) : !item.undone &&
                    item.doc === docPath &&
                    landedUndo.has(thread.id, item.doc, item.sections) ? (
                    <button
                      type="button"
                      className="think-button"
                      onClick={() => {
                        if (!landedUndo.run(thread.id, item.doc, item.sections)) return;
                        void anur.call("thread:auto-taken-back", {
                          thread: thread.id,
                          doc: item.doc,
                          sections: item.sections,
                        });
                      }}
                    >
                      Undo
                    </button>
                  ) : !item.undone && item.doc === docPath ? (
                    <span className="quiet" title="⌘Z on the page takes it back">
                      ⌘Z
                    </span>
                  ) : null}
                </ChangeRow>
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
                <ChangeRow key={i} doc={item.doc} sections={item.sections} state="waiting">
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
                </ChangeRow>
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
                    {item.run ? (
                      <button
                        type="button"
                        className="think-action-run"
                        onClick={() => {
                          if (item.run) setOpen(item.run);
                        }}
                      >
                        <span className="map-pill-icon">
                          {threads.find((t) => t.id === item.run)?.busy ? "…" : "✓"}
                        </span>{" "}
                        {item.title}
                      </button>
                    ) : (
                      <strong>
                        <span className="map-pill-icon">▶</span> {item.title}
                      </strong>
                    )}
                  </div>
                  <div className="think-offer-text">
                    <Markdown text={item.what} />
                  </div>
                  {writable && !item.run
                    ? (() => {
                        const waits = inPlan(queue, { thread: thread.id, action: item.id })
                          ? "Next: runs when the one before is done"
                          : actionWaits(threads, thread, item.id);
                        return (
                          <div className="think-offer-actions">
                            {waits ? (
                              <span className="think-action-waits">{waits}</span>
                            ) : (
                              <button
                                type="button"
                                className="think-button primary"
                                onClick={() => {
                                  void runAction(thread, item);
                                }}
                              >
                                ▶ Run
                              </button>
                            )}
                          </div>
                        );
                      })()
                    : null}
                </div>
              ) : item.kind === "page-gone" ? (
                // A page this thread took out (30.43), with the way to bring it back.
                <div key={i} className="think-changed auto" role="status">
                  <span>
                    {item.back
                      ? item.why === "removed"
                        ? "Removed, then brought back: "
                        : "Kept "
                      : item.why === "removed"
                        ? "Removed "
                        : "Skipped "}
                    <strong>{item.doc}</strong>
                    {!item.back && item.why === "skipped"
                      ? ": its section was removed while this ran."
                      : !item.back
                        ? ", to the Trash."
                        : ""}
                  </span>
                  {item.back ? null : (
                    <button
                      type="button"
                      className="think-button"
                      onClick={() => {
                        void anur
                          .call("thread:page-back", { thread: thread.id, id: item.id })
                          .then((r) => {
                            if (r.kind === "refused") setError(r.reason);
                          });
                      }}
                    >
                      {item.why === "removed" ? "Undo" : "Keep it"}
                    </button>
                  )}
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
          <ChangeSet
            thread={thread}
            writable={writable}
            autoApply={!thread.explores && editsLand(thread.options)}
          />
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
                onOpenLink={onOpenLink}
                notify={notify}
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
        runsThreads(newAgent) &&
        !signedOut(newAgent) ? (
          <div className="think-actions" role="group" aria-label="Actions">
            <button
              type="button"
              className="think-more"
              title={`The agent does what this ${noun} describes, with its own tools, in the mode picked below${buildMode ? ` (${buildMode})` : ""}: Plan shows its plan first, Auto acts at once`}
              onClick={() => {
                build();
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
                disabled={!writable || !runsThreads(newAgent)}
                onSend={(m) => start(m)}
              />
            ))}
      </div>
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
