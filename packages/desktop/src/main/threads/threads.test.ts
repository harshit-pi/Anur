import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { EventPayload } from "../../shared/ipc-contract.ts";
import type { ToHost, ToMain } from "../../agent/protocol.ts";
import { SectionVersions } from "../folder/versions.ts";
import type { AgentHub } from "./hub.ts";
import { Threads, linksIn } from "./threads.ts";

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

  it("opens a session ahead, and the next thread takes it", async () => {
    const { threads: t, sent } = await setup();
    await t.list("plan.md", DOC);
    await new Promise((r) => setTimeout(r, 50));
    const warm = sent.find((m) => m.type === "warm");
    if (warm?.type !== "warm") throw new Error("no spare session was opened");
    const r = await t.start("plan.md", DOC, risks, "Tighten the risk.");
    if (r.kind !== "started") throw new Error(r.reason);
    expect(r.thread.id).toBe(warm.spec.thread);
    // A new spare for the thread after this one.
    await new Promise((res) => setTimeout(res, 50));
    const spares = sent.filter((m) => m.type === "warm");
    expect(spares).toHaveLength(2);
    expect(spares[1]?.type === "warm" && spares[1].spec.thread).not.toBe(r.thread.id);
  });

  it("says in the thread when its edit lands in another doc", async () => {
    const { folder, support, threads: t, reply } = await setup();
    const other = "# Pricing\n\n## Plans\n\nPaid: £4.\n";
    await writeFile(path.join(folder, "pricing.md"), other);
    const r = await t.start("plan.md", DOC, risks, "Fix the price in pricing.md.");
    if (r.kind !== "started") throw new Error(r.reason);
    const copies = path.join(support, "agent", "copies", r.thread.id);
    await writeFile(path.join(copies, "pricing.md"), other.replace("£4", "£3"));
    await reply(r.thread.id, "Proposed.");
    // The turn's merge runs after it ends; wait for it rather than a fixed time.
    const proposed = async () =>
      (await t.list("plan.md", DOC))
        .find((x) => x.id === r.thread.id)
        ?.items.find((i) => i.kind === "proposed");
    for (let n = 0; n < 50 && !(await proposed()); n++)
      await new Promise((res) => setTimeout(res, 100));
    expect(await proposed()).toEqual({
      kind: "proposed",
      doc: "pricing.md",
      sections: [["Pricing", "Plans"]],
    });
    expect(await readFile(path.join(folder, "pricing.md"), "utf8")).toBe(other);
  });

  it("uses a thread's edits across docs at once, and one Undo takes them back, keeping typing since", async () => {
    const { folder, support, threads: t, reply } = await setup();
    const other = "# Pricing\n\n## Plans\n\nPaid: £4.\n\n## Notes\n\nNone.\n";
    await writeFile(path.join(folder, "pricing.md"), other);
    const r = await t.start("plan.md", DOC, risks, "Fix both.");
    if (r.kind !== "started") throw new Error(r.reason);
    const copies = path.join(support, "agent", "copies", r.thread.id);
    await writeFile(path.join(copies, "pricing.md"), other.replace("£4", "£3"));
    await writeFile(path.join(copies, "plan.md"), DOC.replace("untested", "tested"));
    await reply(r.thread.id, "Both proposed.");
    for (let n = 0; n < 50; n++) {
      const v = (await t.list("plan.md", DOC)).find((x) => x.id === r.thread.id);
      if ((v?.changeSet ?? []).length === 2) break;
      await new Promise((res) => setTimeout(res, 100));
    }
    const view = (await t.list("plan.md", DOC)).find((x) => x.id === r.thread.id);
    expect(view?.changeSet?.map((c) => c.doc)).toEqual(["plan.md", "pricing.md"]);
    // The page used plan.md's edit; main uses the rest.
    const after = DOC.replace("untested", "tested");
    const used = await t.useAll(r.thread.id, {
      path: "plan.md",
      before: DOC,
      after,
      sections: [["Plan", "Risks"]],
    });
    expect(used).toEqual({ used: 2, kept: [] });
    expect(await readFile(path.join(folder, "pricing.md"), "utf8")).toContain("£3");
    // Typing in pricing.md since, away from the edit, stays through Undo.
    const typed = other.replace("£4", "£3").replace("None.", "None yet.");
    await writeFile(path.join(folder, "pricing.md"), typed);
    const v2 = (await t.list("plan.md", after)).find((x) => x.id === r.thread.id);
    const note = v2?.items.find((i) => i.kind === "used-all");
    if (note?.kind !== "used-all") throw new Error("no used-all note");
    const undone = await t.undoAll(r.thread.id, note.id, { path: "plan.md", text: after });
    expect(undone).toEqual({ kind: "undone", left: [], page: { path: "plan.md", text: DOC } });
    expect(await readFile(path.join(folder, "pricing.md"), "utf8")).toBe(
      other.replace("None.", "None yet."),
    );
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
    expect(asked?.type === "prompt" && asked.text).toContain("never send it yourself");
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

describe("inputs a person adds, and Branch (group 10)", () => {
  const budget = { index: 2, path: ["Plan", "Budget"] };
  const title = { index: 0, path: ["Plan"] };

  it("adds files and links to a section: outside files copied in, folder files as pointers", async () => {
    const t = await setup();
    await writeFile(path.join(t.folder, "Plan.md"), DOC);
    await writeFile(path.join(t.folder, "notes.md"), "# Notes\n");
    const outside = await mkdtemp(path.join(tmpdir(), "anur-outside-"));
    await writeFile(path.join(outside, "mock.png"), "png-bytes");
    const r = await t.threads.addInputs(
      "Plan.md",
      DOC,
      title.index,
      title.path,
      null,
      [path.join(outside, "mock.png"), path.join(t.folder, "notes.md")],
      ["https://example.com/spec", "not a link"],
    );
    expect(r).toEqual({ added: 3 });
    expect(await readFile(path.join(t.folder, "attachments", "mock.png"), "utf8")).toBe(
      "png-bytes",
    );
    // On the title, so a thread on any section below receives them.
    const below = await t.threads.listInputs("Plan.md", DOC, budget.index, budget.path);
    expect(below.map((c) => [c.source, c.label, c.trust])).toEqual([
      ["attachment", "attachments/mock.png", "trusted"],
      ["file", "notes.md", "trusted"],
      ["link", "example.com/spec", "untrusted"],
    ]);
    // Removed: it no longer reaches new threads.
    const link = below.find((c) => c.source === "link");
    if (!link) throw new Error("no link");
    await t.threads.removeInput("Plan.md", DOC, link.thread, link.id);
    expect(
      (await t.threads.listInputs("Plan.md", DOC, budget.index, budget.path)).map((c) => c.source),
    ).toEqual(["attachment", "file"]);
  });

  it("reaches a thread on the section, named in its bundle, but not a sibling section", async () => {
    const t = await setup();
    await writeFile(path.join(t.folder, "Plan.md"), DOC);
    await writeFile(path.join(t.folder, "notes.md"), "# Notes\n");
    await t.threads.addInputs(
      "Plan.md",
      DOC,
      risks.index,
      risks.path,
      null,
      [path.join(t.folder, "notes.md")],
      [],
    );
    expect(await t.threads.listInputs("Plan.md", DOC, budget.index, budget.path)).toEqual([]);
    const s = await t.threads.start("Plan.md", DOC, risks, "What could go wrong?");
    if (s.kind !== "started") throw new Error(s.reason);
    const prompt = t.sent.filter((m) => m.type === "prompt").at(-1);
    expect(prompt?.type === "prompt" ? prompt.text : "").toContain("notes.md");
  });

  it("branches: the new thread's agent gets the chat up to the message, and nothing after", async () => {
    const t = await setup();
    await writeFile(path.join(t.folder, "Plan.md"), DOC);
    const a = await t.threads.start("Plan.md", DOC, risks, "Remember PELICAN.");
    if (a.kind !== "started") throw new Error(a.reason);
    await t.reply(a.thread.id, "OK, PELICAN.");
    const send = await t.threads.send(
      a.thread.id,
      "Plan.md",
      DOC,
      "Now forget it; the word is OTTER.",
    );
    expect(send.kind).toBe("sent");
    await t.reply(a.thread.id, "OK, OTTER.");
    const items = (await t.threads.list("Plan.md", DOC)).find((x) => x.id === a.thread.id)?.items;
    const upTo = items?.findIndex((i) => i.kind === "message" && i.text === "OK, PELICAN.") ?? -1;
    expect(upTo).toBeGreaterThan(0);
    const b = await t.threads.start(
      "Plan.md",
      DOC,
      risks,
      "Which word?",
      undefined,
      [],
      undefined,
      {
        thread: a.thread.id,
        upTo,
      },
    );
    if (b.kind !== "started") throw new Error(b.reason);
    const prompt = t.sent.filter((m) => m.type === "prompt").at(-1);
    const text = prompt?.type === "prompt" ? prompt.text : "";
    expect(text).toContain("The person: Remember PELICAN.");
    expect(text).toContain("You: OK, PELICAN.");
    expect(text).not.toContain("OTTER");
    expect(text.trim().endsWith("Which word?")).toBe(true);
    // The thread shows only what the person typed, and where it came from.
    expect(b.thread.items.find((i) => i.kind === "message")).toMatchObject({ text: "Which word?" });
    expect(b.thread.branchedFrom).toEqual({ thread: a.thread.id, title: "Remember PELICAN." });
    // A new session: the old thread's isn't resumed.
    expect(prompt?.type === "prompt" ? prompt.spec.resume : "x").toBe(null);
  });

  it("takes a link written in a message as an input, with no attaching", async () => {
    expect(linksIn("See https://example.com/spec, and (https://x.io/a).")).toEqual([
      "https://example.com/spec",
      "https://x.io/a",
    ]);
    const t = await setup();
    await writeFile(path.join(t.folder, "Plan.md"), DOC);
    const s = await t.threads.start("Plan.md", DOC, risks, "Read https://example.com/spec first.");
    if (s.kind !== "started") throw new Error(s.reason);
    const inputs = await t.threads.listInputs("Plan.md", DOC, risks.index, risks.path);
    expect(inputs.map((c) => [c.source, c.label, c.trust])).toEqual([
      ["link", "example.com/spec", "untrusted"],
    ]);
    // Not a chip in the chat: the link is in the message itself.
    expect(s.thread.items.some((i) => i.kind === "attached")).toBe(false);
  });

  it("attaches files and folders sent with a message, shown above it", async () => {
    const t = await setup();
    await writeFile(path.join(t.folder, "Plan.md"), DOC);
    const outside = await mkdtemp(path.join(tmpdir(), "anur-attach-"));
    await writeFile(path.join(outside, "brief.txt"), "HERON");
    await mkdir(path.join(outside, "specs"));
    await writeFile(path.join(outside, "specs", "a.md"), "# A\n");
    const s = await t.threads.start(
      "Plan.md",
      DOC,
      risks,
      "Use these.",
      undefined,
      [],
      undefined,
      undefined,
      [path.join(outside, "brief.txt"), path.join(outside, "specs")],
    );
    if (s.kind !== "started") throw new Error(s.reason);
    expect(await readFile(path.join(t.folder, "attachments", "specs", "a.md"), "utf8")).toBe(
      "# A\n",
    );
    expect(s.thread.items.slice(0, 3)).toEqual([
      { kind: "attached", source: "attachment", label: "attachments/brief.txt" },
      { kind: "attached", source: "attachment", label: "attachments/specs" },
      expect.objectContaining({ kind: "message", role: "person", text: "Use these." }),
    ]);
    const prompt = t.sent.filter((m) => m.type === "prompt").at(-1);
    expect(prompt?.type === "prompt" ? prompt.text : "").toContain("attachments/specs");
    // A text file goes with the message itself, so "use these" is about it.
    const sentText = prompt?.type === "prompt" ? prompt.text : "";
    expect(sentText).toContain("The person attached these to this message");
    expect(sentText).toMatch(/### attachments\/brief\.txt\n```\nHERON\n```/);
  });
});
