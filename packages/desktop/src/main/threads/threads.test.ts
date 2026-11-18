import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { EventPayload } from "../../shared/ipc-contract.ts";
import type { ToHost, ToMain } from "../../agent/protocol.ts";
import { SectionVersions } from "../folder/versions.ts";
import type { AgentHub } from "./hub.ts";
import { Threads } from "./threads.ts";

const DOC = `# Plan

Ship in March.

## Risks

The host is untested.

## Budget

Two people.
`;

/** A stand-in for the agent host: records what it is sent; the test plays the agent. */
function fakeHub() {
  const sent: ToHost[] = [];
  const routes = new Map<string, (m: ToMain) => void>();
  const hub = {
    status: () => ({
      id: "claude-code",
      connected: true,
      reason: null,
      agent: { agent: "2.1.326", adapter: "0.107.3" },
    }),
    route: (t: string, fn: (m: ToMain) => void) => routes.set(t, fn),
    drop: () => undefined,
    send: (m: ToHost) => sent.push(m),
  };
  const reply = async (thread: string, text: string, session = "s-1") => {
    const prompt = sent.filter((m) => m.type === "prompt").at(-1);
    if (prompt?.type !== "prompt") throw new Error("nothing was asked");
    const fn = routes.get(thread);
    fn?.({
      type: "session",
      thread,
      session,
      agent: prompt.spec.agent,
      event: prompt.spec.resume ? "resumed" : "started",
    });
    fn?.({ type: "text", thread, turn: prompt.turn, text });
    fn?.({ type: "turn-end", thread, turn: prompt.turn, stopReason: "end_turn", usage: null });
    await new Promise((r) => setTimeout(r, 50));
  };
  const tell = async (thread: string, m: ToMain) => {
    routes.get(thread)?.(m);
    await new Promise((r) => setTimeout(r, 50));
  };
  return { hub: hub as unknown as AgentHub, sent, reply, tell };
}

let threads: Threads | null = null;
afterEach(async () => {
  await threads?.close();
  threads = null;
});

async function setup() {
  const folder = await mkdtemp(path.join(tmpdir(), "anur-threads-"));
  const versions = new SectionVersions(folder, "dev1");
  const { hub, sent, reply, tell } = fakeHub();
  const events: EventPayload<"thread:event">[] = [];
  threads = new Threads({
    folder,
    device: "dev1",
    appSupport: path.join(folder, "..", `${path.basename(folder)}-support`),
    hub,
    hookScript: "/x/hook.js",
    node: "/x/node",
    locate: (rel, text) => versions.locate(rel, text),
    emit: (e) => events.push(e),
    previewsChanged: () => undefined,
    defaultAgent: () => "claude-code",
  });
  const support = path.join(folder, "..", `${path.basename(folder)}-support`);
  return { folder, support, threads, sent, reply, tell, events };
}

const risks = { index: 1, path: ["Plan", "Risks"] };

describe("Threads", () => {
  it("starts a thread on a section, sending its bundle with the first message", async () => {
    const { threads: t, sent } = await setup();
    const r = await t.start("plan.md", DOC, risks, "Is the host a real risk?");
    expect(r.kind).toBe("started");
    const prompt = sent.find((m) => m.type === "prompt");
    expect(prompt?.type === "prompt" && prompt.text).toContain("## This section: Plan > Risks");
    expect(prompt?.type === "prompt" && prompt.text).toContain("## Budget\n\nTwo people.");
    expect(prompt?.type === "prompt" && prompt.text).toMatch(/---\n\nIs the host a real risk\?$/);
    expect(prompt?.type === "prompt" && prompt.spec.resume).toBeNull();
  });

  it("keeps every message in .anur/, and shows the thread on its section", async () => {
    const { folder, threads: t, reply } = await setup();
    const r = await t.start("plan.md", DOC, risks, "Is the host a real risk?");
    if (r.kind !== "started") throw new Error(r.reason);
    await reply(r.thread.id, "Yes, until it is tested.");
    const [listed] = await t.list("plan.md", DOC);
    expect(listed?.path).toEqual(["Plan", "Risks"]);
    expect(listed?.busy).toBe(false);
    expect(listed?.reads.map((x) => x.label)).toEqual(["Plan", "Risks", "The rest of the doc"]);
    expect(listed?.items.flatMap((i) => (i.kind === "message" ? [i.text] : []))).toEqual([
      "Is the host a real risk?",
      "Yes, until it is tested.",
    ]);
    const docs = await readdir(path.join(folder, ".anur", "docs"));
    const file = path.join(
      folder,
      ".anur",
      "docs",
      docs[0] ?? "",
      "threads",
      r.thread.id,
      "dev1.jsonl",
    );
    const kinds = (await readFile(file, "utf8"))
      .trim()
      .split("\n")
      .map((l) => (JSON.parse(l) as { kind: string }).kind);
    expect(kinds).toEqual(["thread", "turn", "message", "session", "message", "turn"]);
  });

  it("resumes the thread's own session, and sends only the message when nothing changed", async () => {
    const { threads: t, sent, reply } = await setup();
    const r = await t.start("plan.md", DOC, risks, "First?");
    if (r.kind !== "started") throw new Error(r.reason);
    await reply(r.thread.id, "One.");
    await t.send(r.thread.id, "plan.md", DOC, "Second?");
    const second = sent.filter((m) => m.type === "prompt").at(-1);
    expect(second?.type === "prompt" && second.spec.resume).toBe("s-1");
    expect(second?.type === "prompt" && second.text).toBe("Second?");
  });

  it("sends the bundle again when its sections changed", async () => {
    const { threads: t, sent, reply } = await setup();
    const r = await t.start("plan.md", DOC, risks, "First?");
    if (r.kind !== "started") throw new Error(r.reason);
    await reply(r.thread.id, "One.");
    const edited = DOC.replace("The host is untested.", "The host passed its tests.");
    await t.send(r.thread.id, "plan.md", edited, "And now?");
    const next = sent.filter((m) => m.type === "prompt").at(-1);
    expect(next?.type === "prompt" && next.text).toContain("may have changed since your last turn");
    expect(next?.type === "prompt" && next.text).toContain("The host passed its tests.");
  });

  it("refuses a second message while a reply is running", async () => {
    const { threads: t } = await setup();
    const r = await t.start("plan.md", DOC, risks, "First?");
    if (r.kind !== "started") throw new Error(r.reason);
    expect(await t.send(r.thread.id, "plan.md", DOC, "Again?")).toEqual({
      kind: "refused",
      reason: "Wait for the reply, or stop it first.",
    });
  });

  it("rebuilds a thread whose session can't be resumed, from its bundle and chat", async () => {
    const { threads: t, sent, reply, tell } = await setup();
    const r = await t.start("plan.md", DOC, risks, "Remember HERON.");
    if (r.kind !== "started") throw new Error(r.reason);
    await reply(r.thread.id, "OK.");
    await t.send(r.thread.id, "plan.md", DOC, "Which word?");
    const asked = sent.filter((m) => m.type === "prompt").at(-1);
    if (asked?.type !== "prompt") throw new Error("not asked");
    expect(asked.spec.resume).toBe("s-1");
    // The saved session is gone, as after Claude Code removes old transcripts.
    await tell(r.thread.id, {
      type: "error",
      thread: r.thread.id,
      turn: asked.turn,
      message: "resume-failed",
    });
    const rebuilt = sent.filter((m) => m.type === "prompt").at(-1);
    if (rebuilt?.type !== "prompt") throw new Error("not rebuilt");
    expect(rebuilt.spec.resume).toBeNull();
    expect(rebuilt.turn).toBe(asked.turn);
    expect(rebuilt.text).toContain("## This section: Plan > Risks");
    expect(rebuilt.text).toContain("The person: Remember HERON.\n\nYou: OK.");
    expect(rebuilt.text).not.toContain("The person: Which word?");
    expect(rebuilt.text).toMatch(/Which word\?$/);
  });

  it("records an agent that couldn't answer as an error on the thread", async () => {
    const { threads: t, sent, tell } = await setup();
    const r = await t.start("plan.md", DOC, risks, "Hello?");
    if (r.kind !== "started") throw new Error(r.reason);
    const asked = sent.filter((m) => m.type === "prompt").at(-1);
    if (asked?.type !== "prompt") throw new Error("not asked");
    await tell(r.thread.id, {
      type: "error",
      thread: r.thread.id,
      turn: asked.turn,
      message: "Claude Code isn't installed.",
    });
    const [listed] = await t.list("plan.md", DOC);
    expect(listed?.busy).toBe(false);
    expect(listed?.items.at(-1)).toEqual({
      kind: "error",
      turn: asked.turn,
      text: "Claude Code isn't installed.",
    });
  });

  it("gives each turn a working copy, named in the bundle, and turns its edits into a preview", async () => {
    const { support, threads: t, sent, reply } = await setup();
    const r = await t.start("plan.md", DOC, risks, "Tighten the risk.");
    if (r.kind !== "started") throw new Error(r.reason);
    const copy = path.join(support, "agent", "copies", r.thread.id, "plan.md");
    const asked = sent.find((m) => m.type === "prompt");
    expect(asked?.type === "prompt" && asked.text).toContain(`is at \`${copy}\``);
    expect(await readFile(copy, "utf8")).toBe(DOC);
    // The agent edits its copy, then the turn ends.
    await writeFile(copy, DOC.replace("The host is untested.", "The host has no tests yet."));
    await reply(r.thread.id, "Done.");
    const [preview] = await t.listPreviews("plan.md", DOC);
    expect(preview?.title).toBe("Tighten the risk.");
    expect(preview?.parts.map((p) => [p.path, p.base, p.proposed])).toEqual([
      [
        ["Plan", "Risks"],
        "## Risks\n\nThe host is untested.\n\n",
        "## Risks\n\nThe host has no tests yet.\n\n",
      ],
    ]);
  });

  it("starts the next turn's copy from the doc with the preview made, and merges onto newer typing", async () => {
    const { support, threads: t, reply } = await setup();
    const r = await t.start("plan.md", DOC, risks, "Tighten the risk.");
    if (r.kind !== "started") throw new Error(r.reason);
    const copy = path.join(support, "agent", "copies", r.thread.id, "plan.md");
    const once = DOC.replace("The host is untested.", "The host has no tests yet.");
    await writeFile(copy, once);
    await reply(r.thread.id, "Done.");
    // The person typed in Budget meanwhile; the next turn's copy has both.
    const typed = DOC.replace("Two people.", "Two people, part time.");
    await t.send(r.thread.id, "plan.md", typed, "And the budget line?");
    expect(await readFile(copy, "utf8")).toBe(
      once.replace("Two people.", "Two people, part time."),
    );
    await writeFile(
      copy,
      (await readFile(copy, "utf8")).replace("part time.", "part time, from May."),
    );
    await reply(r.thread.id, "Done.");
    const [preview] = await t.listPreviews("plan.md", typed);
    expect(preview?.parts.map((p) => p.path.at(-1))).toEqual(["Risks", "Budget"]);
    expect(preview?.parts[1]?.proposed).toBe("## Budget\n\nTwo people, part time, from May.\n");
  });

  it("moves a thread to another agent: a new session there, rebuilt from its bundle and chat", async () => {
    const { threads: t, sent, reply } = await setup();
    const r = await t.start("plan.md", DOC, risks, "Remember HERON.");
    if (r.kind !== "started") throw new Error(r.reason);
    expect(r.thread.agent).toBe("claude-code");
    await reply(r.thread.id, "OK.");
    t.setAgent(r.thread.id, "codex");
    await t.send(r.thread.id, "plan.md", DOC, "Which word?");
    const moved = sent.filter((m) => m.type === "prompt").at(-1);
    if (moved?.type !== "prompt") throw new Error("not asked");
    expect(moved.spec.agent).toBe("codex");
    expect(moved.spec.resume).toBeNull();
    expect(moved.text).toContain("## This section: Plan > Risks");
    expect(moved.text).toContain("The person: Remember HERON.\n\nYou: OK.");
    await reply(r.thread.id, "HERON.", "codex-1");
    const [listed] = await t.list("plan.md", DOC);
    expect(listed?.agent).toBe("codex");
    // Back on Claude Code, its old session can't hold what Codex said: rebuilt again.
    t.setAgent(r.thread.id, "claude-code");
    await t.send(r.thread.id, "plan.md", DOC, "And now?");
    const back = sent.filter((m) => m.type === "prompt").at(-1);
    expect(back?.type === "prompt" && back.spec.resume).toBeNull();
    expect(back?.type === "prompt" && back.text).toContain("You: HERON.");
  });

  it("merges an edit that background work makes to the copy after the turn ended", async () => {
    const { support, threads: t, reply } = await setup();
    const r = await t.start("plan.md", DOC, risks, "Tighten the risk.");
    if (r.kind !== "started") throw new Error(r.reason);
    const copy = path.join(support, "agent", "copies", r.thread.id, "plan.md");
    await writeFile(copy, DOC.replace("The host is untested.", "The host has no tests yet."));
    await reply(r.thread.id, "Done; a background check is still running.");
    // The background work edits the copy again, after the turn.
    await writeFile(
      copy,
      DOC.replace("The host is untested.", "The host has no tests yet; CI is red."),
    );
    await new Promise((res) => setTimeout(res, 1500));
    const [preview] = await t.listPreviews("plan.md", DOC);
    expect(preview?.parts[0]?.proposed).toContain("The host has no tests yet; CI is red.");
  });

  it("keeps a doc the agent makes, revises it in place, and takes it back on Undo", async () => {
    const { folder, support, threads: t, reply, sent } = await setup();
    const r = await t.start("plan.md", DOC, risks, "-", undefined, [], "build");
    if (r.kind !== "started") throw new Error(r.reason);
    expect(r.thread.title).toBe("Build: Risks");
    expect(r.thread.purpose).toBe("build");
    // The person sees what they did; the agent gets Anur's whole instruction.
    expect(r.thread.items[0]).toMatchObject({ kind: "message", text: "Build this section" });
    const asked = sent.find((m) => m.type === "prompt");
    expect(asked?.type === "prompt" && asked.text).toContain("present the plan for approval");
    const copies = path.join(support, "agent", "copies", r.thread.id);
    await writeFile(path.join(copies, "FAQ.md"), "# FAQ\n");
    await reply(r.thread.id, "Made FAQ.md.");
    expect(await readFile(path.join(folder, "FAQ.md"), "utf8")).toBe("# FAQ\n");
    // Background work revises it after the turn: the made doc follows.
    await writeFile(path.join(copies, "FAQ.md"), "# FAQ\n\nOne question.\n");
    await new Promise((res) => setTimeout(res, 1500));
    expect(await readFile(path.join(folder, "FAQ.md"), "utf8")).toBe("# FAQ\n\nOne question.\n");
    const view = (await t.list("plan.md", DOC)).find((x) => x.id === r.thread.id);
    const made = view?.items.find((i) => i.kind === "created");
    if (made?.kind !== "created") throw new Error("no created note");
    expect(made.doc).toBe("FAQ.md");
    expect(made.undoable).toBe(true);
    expect((await t.undoCreated(r.thread.id, made.id)).kind).toBe("undone");
    expect(await readdir(folder)).not.toContain("FAQ.md");
  });

  it("flags a doc changed outside Anur during the turn, and reverts it", async () => {
    const { folder, threads: t, reply } = await setup();
    await writeFile(path.join(folder, "plan.md"), DOC);
    const r = await t.start("plan.md", DOC, risks, "Thinking about risks.");
    if (r.kind !== "started") throw new Error(r.reason);
    // Something else, such as a git checkout, rewrites the doc mid-turn.
    await writeFile(path.join(folder, "plan.md"), DOC.replace("Two people.", "Three people."));
    await new Promise((res) => setTimeout(res, 800));
    await reply(r.thread.id, "OK.");
    const [listed] = await t.list("plan.md", DOC);
    const flag = listed?.items.find((i) => i.kind === "changed");
    expect(flag).toMatchObject({
      kind: "changed",
      path: "plan.md",
      canRevert: true,
      reverted: false,
    });
    if (flag?.kind !== "changed") throw new Error("no flag");
    const back = t.revertFor(r.thread.id, flag.id);
    expect(back).toMatchObject({ kind: "ok", rel: "plan.md", before: DOC });
  });

  it('keeps clashing unsaved typing as a "your unsaved edit" preview on its section', async () => {
    const { threads: t } = await setup();
    const theirs = DOC.replace("The host is untested.", "The host passed its tests.");
    const mine = DOC.replace("The host is untested.", "The host is untested on Linux.");
    expect(await t.keepUnsaved("plan.md", theirs, mine)).toBe(true);
    const [preview] = await t.listPreviews("plan.md", theirs);
    expect(preview?.thread).toBe("unsaved");
    expect(preview?.title).toBe("Your unsaved edit");
    expect(preview?.parts.map((p) => [p.path.at(-1), p.proposed])).toEqual([
      ["Risks", "## Risks\n\nThe host is untested on Linux.\n\n"],
    ]);
  });

  it("refuses a section that moved away", async () => {
    const { threads: t } = await setup();
    expect(await t.start("plan.md", DOC, { index: 1, path: ["Plan", "Gone"] }, "Hm?")).toEqual({
      kind: "refused",
      reason: "That section changed; try again.",
    });
  });
});
