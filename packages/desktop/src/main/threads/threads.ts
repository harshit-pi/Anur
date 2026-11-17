import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ANUR_DIR,
  ThreadLine,
  anurPaths,
  buildBundle,
  compareLines,
  merge3,
  previewParts,
  withPreview,
  type DocId,
  type PreviewPart,
  type KnownThreadLine,
  type SectionId,
  type SectionTree,
} from "@anur/core";
import type { EventPayload, ThreadItem, ThreadView } from "../../shared/ipc-contract.ts";
import type { SessionSpec, ToMain } from "../../agent/protocol.ts";
import { JsonlWriter, readJsonlFile } from "../../vault/jsonl-writer.ts";
import type { AgentHub } from "./hub.ts";
import { PreviewStore } from "./previews.ts";

/**
 * One folder's threads (tasks 3.1, 3.4, 3.5). Each thread is one discussion
 * on one section, run in its own agent session. Every message and tool call
 * is kept in `.anur/docs/<doc>/threads/<thread>/<device>.jsonl`; nothing a
 * thread said is thrown away.
 *
 * Each turn works on a working copy of the doc (3.6): the doc with this
 * thread's preview made, at a path the bundle names. When the turn ends, the
 * agent's own changes to the copy are merged onto the doc as it is then,
 * and become the thread's preview, one part per section.
 */

type Located = { doc: DocId; tree: SectionTree; ids: SectionId[] };

export type ThreadDeps = {
  folder: string;
  device: string;
  /** App support, where each thread's hook settings and log are kept. */
  appSupport: string;
  hub: AgentHub;
  /** The hook program, run as Node by Electron itself. */
  hookScript: string;
  node: string;
  /** Section IDs for a doc's text, as the page's sections carry them. */
  locate: (rel: string, text: string) => Promise<Located | null>;
  emit: (event: EventPayload<"thread:event">) => void;
  /** A doc's previews changed, so the page shows them again. */
  previewsChanged: (rel: string) => void;
};

/** What a running thread holds in memory: the turn in flight and what it has said so far. */
type Live = {
  threadId: string;
  doc: DocId;
  rel: string;
  turn: string | null;
  text: string;
  tools: Map<string, { title: string; status: string }>;
  written: Set<string>;
  /** The bundle last sent, to tell the agent when its sections changed. */
  lastBundle: string | null;
  /** The text a turn was asked with, kept to retry it when a session can't resume. */
  pending: { message: string; docText: string } | null;
  /** The doc's text as the page last sent it: the editor's, unsaved typing included. */
  docText: string;
  /** The working copy's text when the turn started, to find what the agent changed. */
  copyStart: string | null;
};

const newThreadId = () => `t${randomBytes(9).toString("hex")}`;
const newTurnId = () => `u${randomBytes(6).toString("hex")}`;

export class Threads {
  private readonly live = new Map<string, Live>();
  private readonly writers = new Map<string, Promise<JsonlWriter>>();
  readonly previews: PreviewStore;

  constructor(private readonly d: ThreadDeps) {
    this.previews = new PreviewStore(d.folder, d.device);
  }

  /** Every thread's working copies live here, outside the folder; each thread has its own. */
  private get copiesRoot() {
    return path.join(this.d.appSupport, "agent", "copies");
  }

  private copiesOf(thread: string) {
    return path.join(this.copiesRoot, thread);
  }

  private threadsDir(doc: DocId) {
    return path.join(this.d.folder, ANUR_DIR, anurPaths.doc(doc), "threads");
  }

  private async linesOf(doc: DocId, thread: string): Promise<KnownThreadLine[]> {
    const dir = path.join(this.threadsDir(doc), thread);
    let names: string[];
    try {
      names = (await readdir(dir)).filter((n) => n.endsWith(".jsonl"));
    } catch {
      return [];
    }
    const all = await Promise.all(
      names.map(async (n) => (await readJsonlFile(path.join(dir, n), ThreadLine)).lines),
    );
    return all
      .flat()
      .filter((l): l is KnownThreadLine => "kind" in l && KNOWN.has(l.kind))
      .sort(compareLines);
  }

  private async append(doc: DocId, thread: string, line: Record<string, unknown>): Promise<void> {
    const file = path.join(this.d.folder, ANUR_DIR, anurPaths.thread(doc, thread, this.d.device));
    let w = this.writers.get(file);
    if (!w) {
      w = JsonlWriter.open(file, this.d.device);
      this.writers.set(file, w);
    }
    await (await w).append(line);
  }

  /** Every thread on the doc, each with its section's heading path in `text`. */
  async list(rel: string, text: string): Promise<ThreadView[]> {
    for (const live of this.live.values()) if (live.rel === rel) live.docText = text;
    const at = await this.d.locate(rel, text);
    if (!at) return [];
    let names: string[];
    try {
      names = await readdir(this.threadsDir(at.doc));
    } catch {
      return [];
    }
    const views = await Promise.all(names.map((t) => this.view(at, rel, text, t)));
    return views.filter((v): v is ThreadView => v !== null);
  }

  private async view(at: Located, rel: string, text: string, thread: string) {
    const lines = await this.linesOf(at.doc, thread);
    const start = lines.find((l) => l.kind === "thread");
    if (!start) return null;
    const index = at.ids.indexOf(start.section);
    const items: ThreadItem[] = [];
    let closed = false;
    for (const l of lines) {
      if (l.kind === "message")
        items.push({ kind: "message", turn: l.turn, role: l.role, text: l.text });
      else if (l.kind === "tool")
        items.push({
          kind: "tool",
          turn: l.turn,
          toolUse: l.toolUse,
          title: l.name,
          status: l.status,
        });
      else if (l.kind === "turn" && l.event === "end" && l.stopReason?.startsWith("error:"))
        items.push({ kind: "error", turn: l.turn, text: l.stopReason.slice(6).trim() });
      else if (l.kind === "state") closed = l.state === "closed";
    }
    const live = this.live.get(thread);
    if (live?.turn) {
      for (const [toolUse, t] of live.tools)
        if (!live.written.has(toolUse))
          items.push({ kind: "tool", turn: live.turn, toolUse, title: t.title, status: t.status });
      if (live.text)
        items.push({ kind: "message", turn: live.turn, role: "agent", text: live.text });
    }
    const reads =
      index >= 0
        ? buildBundle({ text, tree: at.tree, index, docPath: rel }).parts.map((p) => ({
            label: p.label,
            detail: p.detail,
          }))
        : [];
    const view: ThreadView = {
      id: thread,
      section: start.section,
      path: index >= 0 ? (at.tree.sections[index]?.path ?? null) : null,
      title: start.title,
      closed,
      busy: Boolean(live?.turn),
      reads,
      items,
    };
    return view;
  }

  private async refresh(rel: string, text: string, thread: string): Promise<void> {
    const at = await this.d.locate(rel, text);
    const v = at ? await this.view(at, rel, text, thread) : null;
    if (v) this.d.emit({ kind: "thread", path: rel, thread: v });
  }

  /** Start a thread on the section at `index`, whose heading path must be `sectionPath`. */
  async start(
    rel: string,
    text: string,
    sectionRef: { index: number; path: string[] },
    message: string,
  ): Promise<{ kind: "started"; thread: ThreadView } | { kind: "refused"; reason: string }> {
    const at = await this.d.locate(rel, text);
    if (!at)
      return {
        kind: "refused",
        reason: "Resolve the doc's merge conflict before starting a thread.",
      };
    const node = at.tree.sections[sectionRef.index];
    const same = node && node.path.join("\u0000") === sectionRef.path.join("\u0000");
    const index = same
      ? sectionRef.index
      : at.tree.sections.findIndex((s) => s.path.join("\u0000") === sectionRef.path.join("\u0000"));
    const section = at.ids[index];
    if (index < 0 || !section)
      return { kind: "refused", reason: "That section changed; try again." };
    const thread = newThreadId();
    await this.append(at.doc, thread, {
      kind: "thread",
      thread,
      doc: at.doc,
      section,
      title: message.split("\n")[0]?.trim().slice(0, 140) ?? "",
      start: "new",
      branchedFrom: null,
    });
    await this.send(thread, rel, text, message, at.doc);
    const v = await this.view(at, rel, text, thread);
    return v
      ? { kind: "started", thread: v }
      : { kind: "refused", reason: "The thread couldn't be read back." };
  }

  /** The next message in a thread. */
  async send(
    thread: string,
    rel: string,
    text: string,
    message: string,
    knownDoc?: DocId,
  ): Promise<{ kind: "sent" } | { kind: "refused"; reason: string }> {
    const at = await this.d.locate(rel, text);
    if (!at) return { kind: "refused", reason: "Resolve the doc's merge conflict first." };
    const doc = knownDoc ?? at.doc;
    const lines = await this.linesOf(doc, thread);
    const start = lines.find((l) => l.kind === "thread");
    if (!start) return { kind: "refused", reason: "That thread isn't in this doc." };
    let live = this.live.get(thread);
    if (live?.turn) return { kind: "refused", reason: "Wait for the reply, or stop it first." };
    live ??= {
      threadId: thread,
      doc,
      rel,
      turn: null,
      text: "",
      tools: new Map(),
      written: new Set(),
      lastBundle: null,
      pending: null,
      docText: text,
      copyStart: null,
    };
    live.rel = rel;
    live.docText = text;
    this.live.set(thread, live);

    const turn = newTurnId();
    live.turn = turn;
    live.text = "";
    live.tools = new Map();
    live.written = new Set();
    live.pending = { message, docText: text };
    const status = this.d.hub.status;
    await this.append(doc, thread, {
      kind: "turn",
      turn,
      event: "start",
      agent: status.agent ? { name: "claude-code", version: status.agent.agent } : null,
      adapter: status.agent ? { name: "claude-agent-acp", version: status.agent.adapter } : null,
      model: null,
      stopReason: null,
      usage: null,
    });
    await this.append(doc, thread, { kind: "message", turn, role: "person", text: message });

    // This device's last session for the thread, if any: sessions live on the machine that ran them.
    const session = lines.filter((l) => l.kind === "session" && l.dev === this.d.device).at(-1);
    const resume = session?.kind === "session" ? session.session : null;
    await this.makeWorkingCopy(thread, live, at);
    const prompt = this.promptFor(
      at,
      start.section,
      rel,
      text,
      message,
      live,
      resume === null ? lines : null,
    );
    if (!prompt) {
      await this.endTurn(thread, live, "error: The section this thread is on is gone.");
      return { kind: "sent" };
    }
    this.d.hub.route(thread, (m) => {
      void this.onHost(thread, m);
    });
    this.d.hub.send({ type: "prompt", spec: await this.spec(thread, resume), turn, text: prompt });
    void this.refresh(rel, text, thread);
    return { kind: "sent" };
  }

  /**
   * What the agent is sent: on a new session, the bundle, then (for a
   * rebuilt one) the chat so far, then the message; later, the message, with
   * the bundle again when its sections changed since it was last sent.
   */
  private promptFor(
    at: Located,
    section: SectionId,
    rel: string,
    text: string,
    message: string,
    live: Live,
    rebuildFrom: KnownThreadLine[] | null,
  ): string | null {
    const index = at.ids.indexOf(section);
    if (index < 0) return null;
    const bundle = buildBundle({
      text,
      tree: at.tree,
      index,
      docPath: rel,
      workingCopy: path.join(this.copiesOf(live.threadId), rel),
    }).markdown;
    const parts: string[] = [];
    if (rebuildFrom) {
      parts.push(bundle);
      const said = rebuildFrom.flatMap((l) => (l.kind === "message" ? [l] : []));
      if (said.length > 0) {
        parts.push(
          "Earlier in this thread:",
          said.map((l) => `${l.role === "person" ? "The person" : "You"}: ${l.text}`).join("\n\n"),
        );
      }
    } else if (live.lastBundle !== bundle) {
      parts.push(
        "The sections this thread works from may have changed since your last turn. They now read:",
        bundle,
      );
    }
    live.lastBundle = bundle;
    parts.push(parts.length > 0 ? `---\n\n${message}` : message);
    return parts.join("\n\n");
  }

  private async spec(thread: string, resume: string | null): Promise<SessionSpec> {
    const dir = path.join(this.d.appSupport, "agent", "hooks");
    await mkdir(dir, { recursive: true });
    const config = path.join(dir, `${thread}.json`);
    const anurDir = path.join(this.d.folder, ANUR_DIR);
    await writeFile(
      config,
      JSON.stringify({
        folder: this.d.folder,
        anurDir,
        thread,
        log: path.join(dir, `${thread}.log.jsonl`),
        copies: this.copiesOf(thread),
        copiesRoot: this.copiesRoot,
      }),
    );
    const hook = {
      type: "command",
      command: "/usr/bin/env",
      args: ["ELECTRON_RUN_AS_NODE=1", this.d.node, this.d.hookScript, config],
      timeout: 10,
    };
    return {
      thread,
      cwd: this.d.folder,
      resume,
      settings: {
        hooks: {
          SessionStart: [{ hooks: [hook] }],
          PreToolUse: [{ matcher: "*", hooks: [hook] }],
        },
        // "//abs/path" is the absolute-path form of a permission rule.
        permissions: {
          deny: ["Read", "Edit", "Write"].map((t) => `${t}(/${anurDir}/**)`),
          // The working copies are part of the agent's workspace, as the folder is.
          additionalDirectories: [this.copiesOf(thread)],
        },
      },
    };
  }

  stop(thread: string): void {
    this.d.hub.send({ type: "cancel", thread });
  }

  private async endTurn(thread: string, live: Live, stopReason: string, usage: unknown = null) {
    const turn = live.turn;
    if (!turn) return;
    if (live.text)
      await this.append(live.doc, thread, {
        kind: "message",
        turn,
        role: "agent",
        text: live.text,
      });
    await this.append(live.doc, thread, {
      kind: "turn",
      turn,
      event: "end",
      agent: null,
      adapter: null,
      model: null,
      stopReason,
      usage,
    });
    live.turn = null;
    live.text = "";
    live.pending = null;
    await this.mergeCopies(thread, live).catch((e: unknown) => {
      console.error("Anur couldn't turn the thread's edits into a preview:", e);
    });
    await this.refresh(live.rel, live.docText, thread);
  }

  /** Where each part's section is in the doc, by section ID. */
  private static byId(at: Located) {
    return (part: PreviewPart) => {
      const i = part.section ? at.ids.indexOf(part.section) : -1;
      return i >= 0 ? (at.tree.sections[i]?.subtreeRange ?? null) : null;
    };
  }

  private static spans(at: Located) {
    return at.tree.sections.map((s, i) => ({
      id: at.ids[i] as SectionId,
      path: s.path,
      subtreeRange: s.subtreeRange,
    }));
  }

  /** The doc with this thread's preview made, written where the agent will edit it. */
  private async makeWorkingCopy(thread: string, live: Live, at: Located): Promise<void> {
    const dir = this.copiesOf(thread);
    await rm(dir, { recursive: true, force: true });
    const preview = await this.previews.read(at.doc, thread);
    const start = withPreview(live.docText, preview?.parts ?? [], Threads.byId(at));
    const copy = path.join(dir, live.rel);
    await mkdir(path.dirname(copy), { recursive: true });
    await writeFile(copy, start);
    live.copyStart = start;
  }

  /**
   * The turn is over: what the agent changed in each working copy is merged
   * onto that doc as it is now, with the thread's preview, and becomes the
   * thread's new preview of it.
   */
  private async mergeCopies(thread: string, live: Live): Promise<void> {
    const dir = this.copiesOf(thread);
    const files = await listFiles(dir);
    for (const rel of files) {
      const copy = await readFile(path.join(dir, rel), "utf8").catch(() => null);
      if (copy === null || !rel.toLowerCase().endsWith(".md")) continue;
      const own = rel === live.rel;
      // The thread's own doc: the page's text. Another doc: the file, as the hook copied it.
      const decided = own
        ? live.docText
        : await readFile(path.join(this.d.folder, rel), "utf8").catch(() => null);
      if (decided === null) continue;
      const start = own ? (live.copyStart ?? decided) : decided;
      if (copy === start) continue;
      const at = await this.d.locate(rel, decided);
      if (!at) continue;
      const existing = await this.previews.read(at.doc, thread);
      const current = withPreview(decided, existing?.parts ?? [], Threads.byId(at));
      const proposed = merge3(start, current, copy, "theirs").text;
      await this.previews.write(at.doc, thread, previewParts(decided, proposed, Threads.spans(at)));
      this.d.previewsChanged(rel);
    }
    live.copyStart = null;
    await rm(dir, { recursive: true, force: true });
  }

  private async onHost(thread: string, m: ToMain): Promise<void> {
    const live = this.live.get(thread);
    if (!live?.turn) return;
    switch (m.type) {
      case "session":
        await this.append(live.doc, thread, {
          kind: "session",
          session: m.session,
          event: m.event,
        });
        return;
      case "text":
        live.text += m.text;
        this.d.emit({ kind: "text", thread, turn: m.turn, text: m.text });
        return;
      case "tool": {
        const prev = live.tools.get(m.toolUse);
        // A path into the working copies reads as what it is: the working copy of that doc.
        const title = (m.title || prev?.title || "A tool")
          .split(`${this.copiesOf(thread)}/`)
          .join("working copy of ");
        live.tools.set(m.toolUse, { title, status: m.status });
        this.d.emit({
          kind: "tool",
          thread,
          turn: m.turn,
          toolUse: m.toolUse,
          title,
          status: m.status,
        });
        if ((m.status === "completed" || m.status === "failed") && !live.written.has(m.toolUse)) {
          live.written.add(m.toolUse);
          await this.append(live.doc, thread, {
            kind: "tool",
            turn: m.turn,
            toolUse: m.toolUse,
            name: title.slice(0, 200),
            input: m.input ?? null,
            status: m.status,
            result: null,
          });
        }
        return;
      }
      case "permission":
        this.d.emit({
          kind: "permission",
          thread,
          request: m.request,
          title: m.title,
          options: m.options,
        });
        return;
      case "turn-end":
        await this.endTurn(thread, live, m.stopReason, m.usage);
        return;
      case "error": {
        if (m.message === "resume-failed" && live.pending) {
          // The saved session is gone, as after Claude Code removes old transcripts: rebuild it.
          const { message, docText } = live.pending;
          const at = await this.d.locate(live.rel, docText);
          const lines = await this.linesOf(live.doc, thread);
          const start = lines.find((l) => l.kind === "thread");
          const prompt =
            at && start?.kind === "thread"
              ? this.promptFor(
                  at,
                  start.section,
                  live.rel,
                  docText,
                  message,
                  live,
                  lines.slice(0, -1),
                )
              : null;
          if (prompt) {
            this.d.hub.send({
              type: "prompt",
              spec: await this.spec(thread, null),
              turn: live.turn,
              text: prompt,
            });
            return;
          }
        }
        await this.endTurn(thread, live, `error: ${m.message}`);
        return;
      }
    }
  }

  /** The doc's previews, each part's heading path as it is in `text`. */
  async listPreviews(rel: string, text: string) {
    const at = await this.d.locate(rel, text);
    if (!at) return [];
    const previews = await this.previews.list(at.doc);
    return Promise.all(
      previews.map(async (p) => {
        const start = (await this.linesOf(at.doc, p.thread)).find((l) => l.kind === "thread");
        return {
          thread: p.thread,
          title: start?.kind === "thread" ? start.title : "A thread",
          parts: p.parts.map((part) => {
            const i = part.section ? at.ids.indexOf(part.section) : -1;
            return { ...part, path: at.tree.sections[i]?.path ?? part.path };
          }),
        };
      }),
    );
  }

  async updatePreview(rel: string, text: string, thread: string, parts: PreviewPart[]) {
    const at = await this.d.locate(rel, text);
    if (!at) return;
    const now = await this.previews.read(at.doc, thread);
    await this.previews.write(at.doc, thread, parts, now?.summary ?? null);
  }

  /** Close every file this folder's threads write. */
  async close(): Promise<void> {
    for (const w of this.writers.values()) await (await w).close().catch(() => undefined);
    this.writers.clear();
    for (const thread of this.live.keys()) this.d.hub.drop(thread);
  }
}

const KNOWN = new Set(["thread", "session", "turn", "message", "tool", "state"]);

/** Every file under `dir`, relative to it, with forward slashes. */
async function listFiles(dir: string, prefix = ""): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(path.join(dir, prefix), { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listFiles(dir, rel)));
    else if (e.isFile()) out.push(rel);
  }
  return out;
}
