import { describe, expect, it } from "vitest";
import type { ThreadItem, ThreadView } from "../../../shared/ipc-contract.ts";
import { withEvent } from "./thread-events.ts";
import { exploresPath, foldSteps, partParent, runningStep, withBranches } from "./thread-steps.ts";

const person = (turn: string, text = "Q"): ThreadItem => ({
  kind: "message",
  turn,
  role: "person",
  text,
});
const agent = (turn: string, text = "A"): ThreadItem => ({
  kind: "message",
  turn,
  role: "agent",
  text,
});
const tool = (
  turn: string,
  toolUse: string,
  title = "Read plan.md",
  status = "completed",
): ThreadItem => ({
  kind: "tool",
  turn,
  toolUse,
  title,
  status,
});
const offer = (turn: string, ids: string[], heading: string | null = null): ThreadItem => ({
  kind: "options",
  turn,
  options: ids.map((id) => ({ id, title: `Option ${id}`, text: id })),
  used: null,
  explored: [],
  within: null,
  heading,
  several: false,
  added: [],
  skipped: [],
});
const thread = (id: string, extra: Partial<ThreadView> = {}): ThreadView => ({
  id,
  section: "s",
  path: ["Plan"],
  title: `Thread ${id}`,
  closed: false,
  busy: false,
  reads: [],
  items: [],
  options: [],
  tokens: null,
  purpose: null,
  agent: "claude-code",
  ...extra,
});

describe("a thread event arriving", () => {
  it("adds a reply's pieces to the same message, a new turn to a new one", () => {
    let items: ThreadItem[] = [person("1")];
    items = withEvent(items, { kind: "text", thread: "t", turn: "1", text: "Hel" });
    items = withEvent(items, { kind: "text", thread: "t", turn: "1", text: "lo" });
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({ role: "agent", text: "Hello" });
    items = withEvent(items, { kind: "text", thread: "t", turn: "2", text: "Again" });
    expect(items).toHaveLength(3);
  });

  it("updates a tool call in place by its id", () => {
    const e = {
      kind: "tool",
      thread: "t",
      turn: "1",
      toolUse: "u1",
      title: "Read",
      status: "running",
    } as const;
    let items = withEvent([], e);
    items = withEvent(items, { ...e, status: "completed" });
    expect(items).toEqual([
      { kind: "tool", turn: "1", toolUse: "u1", title: "Read", status: "completed" },
    ]);
  });
});

describe("a thread's steps as Think lists them", () => {
  it("folds a run of tool steps into one, and leaves a lone step as it is", () => {
    const out = foldSteps([
      person("1"),
      tool("1", "a"),
      tool("1", "b"),
      agent("1"),
      tool("1", "c"),
    ]);
    expect(out.map((e) => e.steps?.length ?? null)).toEqual([null, 2, null, null]);
  });

  it("hides Anur's own bookkeeping steps", () => {
    const out = foldSteps([person("1"), tool("1", "a", "mcp__anur__anur_name_thread"), agent("1")]);
    expect(out.map((e) => e.item.kind)).toEqual(["message", "message"]);
  });

  it("puts a finished turn's reply above the cards it made, not while it runs", () => {
    const items = [person("1"), offer("1", ["x"]), agent("1")];
    const done = foldSteps(items, false);
    expect(done.map((e) => e.item.kind)).toEqual(["message", "message", "options"]);
    expect(done[1]?.leads).toBe(true);
    const running = foldSteps(items, true);
    expect(running.map((e) => e.item.kind)).toEqual(["message", "options", "message"]);
  });

  it("says what the agent is doing only while its last step runs", () => {
    expect(runningStep([tool("1", "a", "Read plan.md", "in_progress")])).not.toBeNull();
    expect(runningStep([tool("1", "a", "Read plan.md", "completed")])).toBeNull();
    expect(runningStep([agent("1")])).toBeNull();
  });
});

describe("threads in order", () => {
  it("lists newest first, each branch right under its source", () => {
    const ts = [
      thread("old", { lastAt: "2026-11-01" }),
      thread("new", { lastAt: "2026-11-03" }),
      thread("branch", {
        lastAt: "2026-11-04",
        branchedFrom: { thread: "old", title: "Thread old" },
      }),
    ];
    expect(withBranches(ts).map((t) => t.id)).toEqual(["new", "old", "branch"]);
  });

  it("names where an exploring thread sits: the decision, then each option narrowed", () => {
    const root = thread("root", { items: [offer("1", ["a", "b"], "Pricing model")] });
    const mid = thread("mid", {
      explores: { thread: "root", option: "a" },
      items: [offer("1", ["c"])],
    });
    const leaf = thread("leaf", { explores: { thread: "mid", option: "c" } });
    expect(exploresPath(leaf, [root, mid, leaf])).toEqual([
      "Pricing model",
      "Option a",
      "Option c",
    ]);
    expect(exploresPath(root, [root])).toEqual([]);
  });
});

describe("a narrower part's parent", () => {
  type Options = Extract<ThreadItem, { kind: "options" }>;
  const parts = (within: string | null = null, ids = ["p", "q"]): ThreadItem => ({
    ...(offer("1", ids) as Options),
    several: true,
    within,
  });
  it("is the part it was found exploring", () => {
    const root = thread("root", { items: [parts(null, ["p", "q"])] });
    const deep = thread("deep", { items: [parts("p", ["r", "s"])] });
    expect(partParent([root, deep], deep, "r")).toMatchObject({ title: "Option p" });
  });
  it("is none for a first set, a choice explored, or narrower choices of one", () => {
    const root = thread("root", { items: [parts(null, ["p", "q"])] });
    expect(partParent([root], root, "p")).toBeNull();
    const pick = thread("pick", { items: [offer("1", ["c", "d"])] });
    const deep = thread("deep", { items: [parts("c", ["r", "s"])] });
    expect(partParent([pick, deep], deep, "r")).toBeNull();
    const narrowChoice = thread("nc", {
      items: [{ ...(offer("1", ["r"]) as Options), within: "p" }],
    });
    expect(partParent([root, narrowChoice], narrowChoice, "r")).toBeNull();
  });
});
