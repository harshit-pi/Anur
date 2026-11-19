import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { EventPayload } from "../../shared/ipc-contract.ts";
import type { ToHost, ToMain } from "../../agent/protocol.ts";
import { SectionVersions } from "../folder/versions.ts";
import { HomeVersions } from "../folder/home-versions.ts";
import { execFileSync } from "node:child_process";
import type { AgentHub } from "./hub.ts";
import { Threads, appliesTo, linksIn, reachOf } from "./threads.ts";

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
    await threads?.settled();
  };
  const tell = async (thread: string, m: ToMain) => {
    routes.get(thread)?.(m);
    await threads?.settled();
  };
  return { hub: hub as unknown as AgentHub, sent, reply, tell };
}

let threads: Threads | null = null;
afterEach(async () => {
  await threads?.close();
  threads = null;
});

async function setup(extra: Partial<ConstructorParameters<typeof Threads>[0]> = {}) {
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
    ...extra,
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

  it("marks a check's spelling slips as wording, and anything unmarked as a fact (17.3)", async () => {
    const { threads: t, reply } = await setup();
    const r = await t.start("plan.md", DOC, risks, "Check this section.");
    if (r.kind !== "started") throw new Error(r.reason);
    const tool = (
      t as unknown as { tool: (th: string, n: string, args: unknown) => Promise<unknown> }
    ).tool.bind(t);
    await tool(r.thread.id, "anur_report_check", {
      claims: [
        { claim: "The host costs £5.", verdict: "wrong", source: "invoice", note: "It's £40." },
        { claim: "teh host", verdict: "wrong", source: "-", note: "Spelling.", about: "wording" },
      ],
    });
    await reply(r.thread.id, "Checked.");
    const view = (await t.list("plan.md", DOC)).find((x) => x.id === r.thread.id);
    const check = view?.items.find((i) => i.kind === "check");
    if (check?.kind !== "check") throw new Error("no check");
    expect(check.claims.map((c) => c.about)).toEqual(["fact", "wording"]);
  });

  it("carries a kept finding to new threads on the section, and never an unkept one", async () => {
    const { threads: t, sent, reply } = await setup();
    const a = await t.start("plan.md", DOC, risks, "What does the host cost?");
    if (a.kind !== "started") throw new Error(a.reason);
    // The agent proposes two findings during its turn.
    const tool = (
      t as unknown as { tool: (th: string, n: string, args: unknown) => Promise<unknown> }
    ).tool.bind(t);
    await tool(a.thread.id, "anur_propose_finding", {
      claim: "The host costs £40 a month.",
      source: "invoice.pdf",
    });
    await tool(a.thread.id, "anur_propose_finding", {
      claim: "The host is in Frankfurt.",
      source: "status page",
    });
    await reply(a.thread.id, "Two findings proposed.");
    const view = (await t.list("plan.md", DOC)).find((x) => x.id === a.thread.id);
    const proposed = (view?.items ?? []).flatMap((i) => (i.kind === "finding" ? [i] : []));
    expect(proposed.map((f) => f.status)).toEqual(["proposed", "proposed"]);
    const first = proposed[0];
    if (!first) throw new Error("no finding");
    await t.decideFinding(a.thread.id, { id: first.id, status: "kept", claim: null });
    const b = await t.start("plan.md", DOC, risks, "Plan the hosting budget.");
    if (b.kind !== "started") throw new Error(b.reason);
    const asked = sent.filter((m) => m.type === "prompt").at(-1);
    const text = asked?.type === "prompt" ? asked.text : "";
    expect(text).toContain("- The host costs £40 a month. (source: invoice.pdf)");
    expect(text).not.toContain("Frankfurt");
    // Dropped, it stops carrying.
    await t.decideFinding(a.thread.id, { id: first.id, status: "dropped", claim: null });
    expect(await t.listFindings("plan.md", DOC, risks.index, risks.path)).toEqual([]);
  });

  it("carries a teammate's committed decision from above the section, as the folder collects it (18.14)", async () => {
    const teammate = {
      id: "d0000000-0000-4000-8000-000000000001",
      at: "2026-11-18T10:00:00.000Z",
      dev: "mac-b",
      seq: 0,
      kind: "decision" as const,
      scope: "section:plan.md#Plan",
      ref: null,
      decision: "Three retries, not infinite",
      quote: "three retries, not infinite",
      instead: "infinite",
      until: null,
      who: "Priya",
      person: "priya",
      home: "",
    };
    const elsewhere = {
      ...teammate,
      id: "d0000000-0000-4000-8000-000000000002",
      scope: "section:other.md#Plan",
      decision: "Use Stripe",
    };
    const { threads: t, sent } = await setup({
      committed: {
        keep: () => Promise.resolve(null),
        drop: () => Promise.resolve(),
        collected: () => Promise.resolve([teammate, elsewhere]),
      },
    });
    const r = await t.start("plan.md", DOC, risks, "Plan the retries.");
    if (r.kind !== "started") throw new Error(r.reason);
    const asked = sent.find((m) => m.type === "prompt");
    const text = asked?.type === "prompt" ? asked.text : "";
    expect(text).toMatch(
      /- Decided by Priya \(\d+ \w+\): Three retries, not infinite Instead of: infinite\. \[on Plan\]/,
    );
    expect(text).not.toContain("Use Stripe");
    const listed = await t.listFindings("plan.md", DOC, risks.index, risks.path);
    expect(listed.map((f) => [f.claim, f.who])).toEqual([["Three retries, not infinite", "Priya"]]);
  });

  it("settles a confident decision in the person's own words, and carries it with their name", async () => {
    const { threads: t, sent, reply } = await setup();
    const a = await t.start(
      "plan.md",
      DOC,
      risks,
      "No, three retries, not infinite. Stripe rate-limits us. Shouldn't we log each one too?",
    );
    if (a.kind !== "started") throw new Error(a.reason);
    const tool = (
      t as unknown as {
        tool: (th: string, n: string, args: unknown) => Promise<{ error?: string }>;
      }
    ).tool.bind(t);
    // Theirs, and sure: settles with Undo.
    await tool(a.thread.id, "anur_note_decision", {
      quote: "three retries, not infinite",
      decision: "Three retries, not infinite.",
      instead: "retry until it succeeds",
      confidence: 0.9,
    });
    // A question: waits for a Keep, however sure.
    await tool(a.thread.id, "anur_note_decision", {
      quote: "Shouldn't we log each one too",
      decision: "Log each retry.",
      confidence: 0.95,
    });
    // Never typed: refused, nothing recorded.
    const refused = await tool(a.thread.id, "anur_note_decision", {
      quote: "five retries",
      decision: "Five retries.",
      confidence: 0.99,
    });
    expect(refused.error).toMatch(/isn't in anything the person typed/);
    await reply(a.thread.id, "Done.");
    const view = (await t.list("plan.md", DOC)).find((x) => x.id === a.thread.id);
    const decisions = (view?.items ?? []).flatMap((i) => (i.kind === "finding" ? [i] : []));
    expect(decisions.map((d) => [d.claim, d.status, d.auto])).toEqual([
      ["Three retries, not infinite.", "kept", true],
      ["Log each retry.", "proposed", false],
    ]);
    const b = await t.start("plan.md", DOC, risks, "Add the payment job.");
    if (b.kind !== "started") throw new Error(b.reason);
    const asked = sent.filter((m) => m.type === "prompt").at(-1);
    const text = asked?.type === "prompt" ? asked.text : "";
    expect(text).toContain("## Decided on this section");
    expect(text).toMatch(
      /- Decided by \S+ \(\d+ \w+\): Three retries, not infinite\. Instead of: retry until it succeeds\./,
    );
    expect(text).not.toContain("Log each retry");
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

  it("after a restart, Use all still uses every doc's edits and shows the thread again", async () => {
    const { folder, support, threads: t, reply, events } = await setup();
    const other = "# Pricing\n\n## Plans\n\nPaid: £4.\n";
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
    // A restart: nothing about the thread is held in memory.
    (t as unknown as { live: Map<string, unknown> }).live.clear();
    events.length = 0;
    const after = DOC.replace("untested", "tested");
    const used = await t.useAll(r.thread.id, {
      path: "plan.md",
      before: DOC,
      after,
      sections: [["Plan", "Risks"]],
    });
    expect(used).toEqual({ used: 2, kept: [] });
    expect(await readFile(path.join(folder, "pricing.md"), "utf8")).toContain("£3");
    // The thread is shown again without pricing.md's edit (the page clears the open doc's own).
    const shown = events.findLast((e) => e.kind === "thread");
    if (shown?.kind !== "thread") throw new Error("the thread wasn't shown again");
    expect(shown.thread.changeSet?.map((c) => c.doc)).not.toContain("pricing.md");
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

  it("shows nothing for a doc changed outside Anur during the turn", async () => {
    const { folder, threads: t, reply } = await setup();
    await writeFile(path.join(folder, "plan.md"), DOC);
    const r = await t.start("plan.md", DOC, risks, "Thinking about risks.");
    if (r.kind !== "started") throw new Error(r.reason);
    // Something else, such as a git checkout, rewrites the doc mid-turn.
    await writeFile(path.join(folder, "plan.md"), DOC.replace("Two people.", "Three people."));
    await new Promise((res) => setTimeout(res, 800));
    await reply(r.thread.id, "OK.");
    const [listed] = await t.list("plan.md", DOC);
    expect(listed?.items.map((i) => i.kind)).toEqual(["message", "message"]);
    // And the write stands: nothing put it back.
    expect(await readFile(path.join(folder, "plan.md"), "utf8")).toContain("Three people.");
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

describe("threads in each doc's home (18.15.2)", () => {
  const README = "# Api\n\nHow to run it.\n\n## Setup\n\nnpm install\n";

  /** A workspace with two repos, each with a README, and threads routed by home. */
  async function homes(ws?: string) {
    const folder = ws ?? (await mkdtemp(path.join(tmpdir(), "anur-thomes-")));
    if (!ws)
      for (const r of ["api", "web"]) {
        await mkdir(path.join(folder, r));
        execFileSync("git", ["-C", path.join(folder, r), "init", "-q"]);
        await writeFile(path.join(folder, r, "README.md"), README);
      }
    const versions = new HomeVersions(folder, "dev1");
    const { hub, sent, reply } = fakeHub();
    threads = new Threads({
      folder,
      device: "dev1",
      appSupport: path.join(folder, "..", `${path.basename(folder)}-support`),
      hub,
      hookScript: "/x/hook.js",
      node: "/x/node",
      locate: (rel, text) => versions.locate(rel, text),
      anurDirOf: (doc) => versions.anurDirOf(doc),
      anurDirs: () => versions.anurDirs(),
      emit: () => undefined,
      previewsChanged: () => undefined,
      defaultAgent: () => "claude-code",
    });
    return { folder, t: threads, sent, reply };
  }
  const setupSection = { index: 1, path: ["Api", "Setup"] };

  it("keeps a thread on a repo's doc in that repo's .anur/, not the workspace's", async () => {
    const { folder, t } = await homes();
    const r = await t.start("api/README.md", README, setupSection, "How do I run it?");
    if (r.kind !== "started") throw new Error(r.reason);
    const docs = await readdir(path.join(folder, "api", ".anur", "docs"));
    expect(docs).toHaveLength(1);
    expect(
      await readdir(path.join(folder, "api", ".anur", "docs", docs[0] ?? "", "threads")),
    ).toEqual([r.thread.id]);
    expect(await readdir(path.join(folder, ".anur")).catch(() => [])).not.toContain("docs");
    const [listed] = await t.list("api/README.md", README);
    expect(listed?.id).toBe(r.thread.id);
  });

  it("keeps two repos' READMEs' threads apart, though they share a path in their repos", async () => {
    const { t } = await homes();
    const a = await t.start("api/README.md", README, setupSection, "Api question");
    const b = await t.start("web/README.md", README, setupSection, "Web question");
    if (a.kind !== "started" || b.kind !== "started") throw new Error("not started");
    expect((await t.list("api/README.md", README)).map((x) => x.id)).toEqual([a.thread.id]);
    expect((await t.list("web/README.md", README)).map((x) => x.id)).toEqual([b.thread.id]);
  });

  it("finds a repo doc's thread again after a restart, by its id alone", async () => {
    const first = await homes();
    const r = await first.t.start("api/README.md", README, setupSection, "What does it cost?");
    if (r.kind !== "started") throw new Error(r.reason);
    const tool = (
      first.t as unknown as { tool: (th: string, n: string, args: unknown) => Promise<unknown> }
    ).tool.bind(first.t);
    await tool(r.thread.id, "anur_propose_finding", { claim: "It costs £40.", source: "bill.pdf" });
    await first.reply(r.thread.id, "Proposed.");
    const view = (await first.t.list("api/README.md", README)).find((x) => x.id === r.thread.id);
    const finding = (view?.items ?? []).find((i) => i.kind === "finding");
    await first.t.close();
    threads = null;
    // A fresh start: nothing live, so the thread is found by looking in each home.
    const again = await homes(first.folder);
    if (finding?.kind !== "finding") throw new Error("no finding");
    const decided = await again.t.decideFinding(r.thread.id, {
      id: finding.id,
      status: "kept",
      claim: null,
    });
    expect(decided).toEqual({ kind: "ok" });
  });

  it("closes every home's .anur/ to the agent, the folder's and each repo's", async () => {
    const { folder, t, sent } = await homes();
    const r = await t.start("api/README.md", README, setupSection, "Go");
    if (r.kind !== "started") throw new Error(r.reason);
    const prompt = sent.find((m) => m.type === "prompt");
    if (prompt?.type !== "prompt") throw new Error("nothing asked");
    const config = JSON.parse(await readFile(prompt.spec.guard.hook.args.at(-1) ?? "", "utf8")) as {
      anurDirs: string[];
    };
    expect(config.anurDirs).toEqual(["", "api", "web"].map((h) => path.join(folder, h, ".anur")));
    expect(prompt.spec.guard.anurDirs).toEqual(config.anurDirs);
  });
});

describe("where a committed decision reaches (23.4)", () => {
  it("a section's reaches it and below; a repo's or folder's reaches every doc inside", () => {
    expect(appliesTo("section:README.md#Api", "api", "api/README.md", ["Api", "Setup"])).toBe(
      "Api",
    );
    expect(
      appliesTo("section:README.md#Api › Other", "api", "api/README.md", ["Api", "Setup"]),
    ).toBeNull();
    expect(appliesTo("repo", "api", "api/docs/x.md", [])).toBe("all of api");
    expect(appliesTo("repo", "api", "web/README.md", [])).toBeNull();
    expect(appliesTo("repo", "api", "apix/README.md", [])).toBeNull();
    expect(appliesTo("repo", "", "notes/plan.md", [])).toBe("the whole folder");
    expect(appliesTo("folder:docs", "api", "api/docs/x.md", [])).toBe("all of api/docs");
    expect(appliesTo("folder:docs", "api", "api/src/x.md", [])).toBeNull();
    // A part's (23.1): docs inside the folder it covers, named by the part.
    const part = { on: "@acme/api", within: "src" };
    expect(appliesTo("part:p1", "api", "api/src/auth/x.md", [], part)).toBe("@acme/api");
    expect(appliesTo("part:p1", "api", "api/docs/x.md", [], part)).toBeNull();
    expect(appliesTo("part:p1", "api", "api/README.md", [], { on: "Api", within: "" })).toBe("Api");
    expect(
      appliesTo("part:p1", "api", "api/README.md", [], { on: "Api", within: null }),
    ).toBeNull();
    expect(appliesTo("edge:e1", "api", "api/README.md", [])).toBeNull();
    expect(reachOf("part:p1", [])).toBeGreaterThan(reachOf("section:a.md#", []));
    expect(reachOf("part:p1", [])).toBeLessThan(reachOf("repo", []));
    expect(appliesTo("part:abc", "api", "api/README.md", [])).toBeNull();
  });

  it("carries a decision made from a terminal for a whole repo into a thread on any doc in it", async () => {
    const repoWide = {
      id: "d0000000-0000-4000-8000-000000000009",
      at: "2026-11-18T10:00:00.000Z",
      dev: "mac-b",
      seq: 0,
      kind: "decision" as const,
      scope: "repo",
      ref: "term-1",
      decision: "Three retries, never infinite.",
      quote: "three retries",
      instead: null,
      until: null,
      who: "Priya",
      person: "priya",
      home: "",
    };
    const { threads: t, sent } = await setup({
      committed: {
        keep: () => Promise.resolve(null),
        drop: () => Promise.resolve(),
        collected: () => Promise.resolve([repoWide]),
      },
    });
    const r = await t.start("plan.md", DOC, risks, "Plan the retries.");
    if (r.kind !== "started") throw new Error(r.reason);
    const asked = sent.find((m) => m.type === "prompt");
    expect(asked?.type === "prompt" ? asked.text : "").toMatch(
      /Decided by Priya .*Three retries, never infinite\. \[on the whole folder\]/,
    );
  });
});

describe("carried nearest first (18.3)", () => {
  it("ranks a section's own, then above, the doc, the repo, and everywhere", () => {
    expect(reachOf("section:plan.md#Plan › Risks", ["Plan", "Risks"])).toBe(0);
    expect(reachOf("section:plan.md#Plan", ["Plan", "Risks"])).toBe(1);
    expect(reachOf("section:plan.md#", ["Plan", "Risks"])).toBe(2);
    expect(reachOf("repo", ["Plan", "Risks"])).toBe(3);
    expect(reachOf("folder:docs", ["Plan", "Risks"])).toBe(3);
    expect(reachOf("everywhere", ["Plan", "Risks"])).toBe(4);
    expect(appliesTo("everywhere", "~", "anything/at/all.md", [])).toBe("everywhere");
  });

  it("puts a section's own decision before its doc's, its repo's and everywhere's in a new thread", async () => {
    const base = {
      at: "2026-11-18T10:00:00.000Z",
      dev: "mac-b",
      seq: 0,
      kind: "decision" as const,
      ref: null,
      quote: "q",
      instead: null,
      until: null,
      who: "Priya",
      person: "priya",
      home: "",
    };
    const entries = [
      {
        ...base,
        id: "e0000000-0000-4000-8000-000000000001",
        scope: "everywhere",
        decision: "Everywhere rule",
        home: "~",
      },
      { ...base, id: "e0000000-0000-4000-8000-000000000002", scope: "repo", decision: "Repo rule" },
      {
        ...base,
        id: "e0000000-0000-4000-8000-000000000003",
        scope: "section:plan.md#",
        decision: "Doc rule",
      },
      {
        ...base,
        id: "e0000000-0000-4000-8000-000000000004",
        scope: "section:plan.md#Plan › Risks",
        decision: "Section rule",
      },
    ];
    const { threads: t, sent } = await setup({
      committed: {
        keep: () => Promise.resolve(null),
        drop: () => Promise.resolve(),
        collected: () => Promise.resolve(entries),
      },
    });
    const r = await t.start("plan.md", DOC, risks, "Go.");
    if (r.kind !== "started") throw new Error(r.reason);
    const asked = sent.find((m) => m.type === "prompt");
    const text = asked?.type === "prompt" ? asked.text : "";
    const order = ["Section rule", "Doc rule", "Repo rule", "Everywhere rule"].map((x) =>
      text.indexOf(x),
    );
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("passes the scope a person picks on to the committed copy", async () => {
    const kept: string[] = [];
    const { threads: t, reply } = await setup({
      committed: {
        keep: (_rel, _section, _ref, _entry, scope) => {
          kept.push(scope ?? "section");
          return Promise.resolve(null);
        },
        drop: () => Promise.resolve(),
      },
    });
    const a = await t.start("plan.md", DOC, risks, "What does the host cost?");
    if (a.kind !== "started") throw new Error(a.reason);
    const tool = (
      t as unknown as { tool: (th: string, n: string, args: unknown) => Promise<unknown> }
    ).tool.bind(t);
    await tool(a.thread.id, "anur_propose_finding", { claim: "£40 a month.", source: "bill.pdf" });
    await reply(a.thread.id, "Proposed.");
    const view = (await t.list("plan.md", DOC)).find((x) => x.id === a.thread.id);
    const f = (view?.items ?? []).find((i) => i.kind === "finding");
    if (f?.kind !== "finding") throw new Error("no finding");
    await t.decideFinding(a.thread.id, { id: f.id, status: "kept", claim: null, scope: "doc" });
    expect(kept).toEqual(["doc"]);
    const again = (await t.list("plan.md", DOC)).find((x) => x.id === a.thread.id);
    const shown = (again?.items ?? []).find((i) => i.kind === "finding");
    expect(shown?.kind === "finding" && shown.scope).toBe("doc");
  });
});

describe("a thread that isn't open still reaches the committed copy", () => {
  it("passes a scope change and an Undo through after a restart", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "anur-closed-"));
    await writeFile(path.join(folder, "plan.md"), DOC);
    const calls: string[] = [];
    const committed = {
      keep: (rel: string, _s: string, _r: string, _e: unknown, scope?: string) => {
        calls.push(`keep ${rel} ${scope ?? "section"}`);
        return Promise.resolve(null);
      },
      drop: (rel: string) => {
        calls.push(`drop ${rel}`);
        return Promise.resolve();
      },
    };
    const versions = new HomeVersions(folder, "dev1");
    const make = () => {
      const { hub, reply } = fakeHub();
      threads = new Threads({
        folder,
        device: "dev1",
        appSupport: path.join(folder, "..", `${path.basename(folder)}-support`),
        hub,
        hookScript: "/x/hook.js",
        node: "/x/node",
        locate: (rel, text) => versions.locate(rel, text),
        relOf: (doc) => versions.relOf(doc),
        anurDirOf: (doc) => versions.anurDirOf(doc),
        anurDirs: () => versions.anurDirs(),
        emit: () => undefined,
        previewsChanged: () => undefined,
        defaultAgent: () => "claude-code",
        committed,
      });
      return { t: threads, reply };
    };
    const first = make();
    const r = await first.t.start("plan.md", DOC, risks, "What does the host cost?");
    if (r.kind !== "started") throw new Error(r.reason);
    const tool = (
      first.t as unknown as { tool: (th: string, n: string, args: unknown) => Promise<unknown> }
    ).tool.bind(first.t);
    await tool(r.thread.id, "anur_propose_finding", { claim: "£40 a month.", source: "bill.pdf" });
    await first.reply(r.thread.id, "Proposed.");
    const view = (await first.t.list("plan.md", DOC)).find((x) => x.id === r.thread.id);
    const f = (view?.items ?? []).find((i) => i.kind === "finding");
    if (f?.kind !== "finding") throw new Error("no finding");
    await first.t.decideFinding(r.thread.id, { id: f.id, status: "kept", claim: null });
    await first.t.close();
    // Restarted: nothing live.
    const again = make();
    await again.t.decideFinding(r.thread.id, {
      id: f.id,
      status: "kept",
      claim: null,
      scope: "doc",
    });
    await again.t.decideFinding(r.thread.id, { id: f.id, status: "dropped", claim: null });
    expect(calls).toEqual(["keep plan.md section", "keep plan.md doc", "drop plan.md"]);
  });
});
