import { describe, expect, it } from "vitest";
import type { ThreadView } from "../../../shared/ipc-contract.ts";
import { actionWaits } from "./action-waits.ts";

type Item = ThreadView["items"][number];

const thread = (
  id: string,
  path: string[],
  items: Item[],
  extra: Partial<ThreadView> = {},
): ThreadView => ({
  id,
  section: "s",
  path,
  title: `Thread ${id}`,
  closed: false,
  busy: false,
  reads: [],
  items,
  options: [],
  tokens: null,
  purpose: null,
  agent: "claude-code",
  ...extra,
});

const action = (
  id: string,
  title: string,
  run: string | null = null,
  path: string[] | null = null,
): Item => ({
  kind: "proposed-action",
  id,
  title,
  what: `Do ${title}`,
  path,
  run,
});

const choice = (o: Partial<Extract<Item, { kind: "options" }>> = {}): Item => ({
  kind: "options",
  turn: "u1",
  options: [
    { id: "a", title: "Free trial", text: "" },
    { id: "b", title: "Discount", text: "" },
  ],
  used: null,
  explored: [],
  within: null,
  heading: "Offer",
  several: false,
  added: [],
  skipped: [],
  ...o,
});

const build = (id: string, state: "running" | "done" | "failed" | "stopped" | "needs") =>
  thread(id, ["Plan", "Launch"], [], {
    purpose: "build",
    action: { state, detail: "", ask: null },
  });

const LAUNCH = ["Plan", "Launch"];

describe("whether a planned action can run", () => {
  it("is ready with nothing before it and no open choice", () => {
    const t = thread("t1", LAUNCH, [action("x", "Email drafts")]);
    expect(actionWaits([t], t, "x")).toBeNull();
  });

  it("waits while its section has a pick to make, and not once it's made", () => {
    const t = thread("t1", LAUNCH, [choice(), action("x", "Email drafts")]);
    expect(actionWaits([t], t, "x")).toBe("Waits on your pick: “Offer”");
    const picked = thread("t1", LAUNCH, [choice({ used: "a" }), action("x", "Email drafts")]);
    expect(actionWaits([picked], picked, "x")).toBeNull();
  });

  it("waits on another thread's open choice in the same section, not one elsewhere or closed", () => {
    const t = thread("t1", LAUNCH, [action("x", "Email drafts")]);
    const other = thread("t2", LAUNCH, [choice()]);
    expect(actionWaits([t, other], t, "x")).toBe("Waits on your pick: “Offer”");
    const elsewhere = thread("t3", ["Plan", "Budget"], [choice()]);
    expect(actionWaits([t, elsewhere], t, "x")).toBeNull();
    const closed = thread("t2", LAUNCH, [choice()], { closed: true });
    expect(actionWaits([t, closed], t, "x")).toBeNull();
  });

  it("waits on its own thread's open choice even when it acts on another section", () => {
    const t = thread("t1", LAUNCH, [
      choice(),
      action("x", "File issues", null, ["Plan", "Budget"]),
    ]);
    expect(actionWaits([t], t, "x")).toBe("Waits on your pick: “Offer”");
  });

  it("doesn't wait on parts left unadded, a set all skipped, or a choice asked again and picked", () => {
    const parts = thread("t1", LAUNCH, [choice({ several: true }), action("x", "Email drafts")]);
    expect(actionWaits([parts], parts, "x")).toBeNull();
    const skipped = thread("t1", LAUNCH, [
      choice({ skipped: ["a", "b"] }),
      action("x", "Email drafts"),
    ]);
    expect(actionWaits([skipped], skipped, "x")).toBeNull();
    const askedAgain = thread("t1", LAUNCH, [
      choice(),
      choice({ used: "b" }),
      action("x", "Email drafts"),
    ]);
    expect(actionWaits([askedAgain], askedAgain, "x")).toBeNull();
  });

  it("waits on narrower choices only under the option picked", () => {
    const narrower = choice({ within: "a", heading: "Trial length" });
    const underPicked = thread("t1", LAUNCH, [
      choice({ used: "a" }),
      narrower,
      action("x", "Drafts"),
    ]);
    expect(actionWaits([underPicked], underPicked, "x")).toBe("Waits on your pick: “Trial length”");
    const underOther = thread("t1", LAUNCH, [
      choice({ used: "b" }),
      narrower,
      action("x", "Drafts"),
    ]);
    expect(actionWaits([underOther], underOther, "x")).toBeNull();
  });

  it("waits on an earlier action in the plan until it has run and is done", () => {
    const plan = (run: string | null) =>
      thread("t1", LAUNCH, [action("x", "Pick the list", run), action("y", "Send emails")]);
    expect(actionWaits([plan(null)], plan(null), "y")).toBe("Waits on “Pick the list”");
    for (const state of ["running", "needs", "failed", "stopped"] as const) {
      const t = plan("b1");
      expect(actionWaits([t, build("b1", state)], t, "y"), state).toBe("Waits on “Pick the list”");
    }
    const done = plan("b1");
    expect(actionWaits([done, build("b1", "done")], done, "y")).toBeNull();
    // The first in the plan never waits on the ones after it.
    expect(actionWaits([plan(null)], plan(null), "x")).toBeNull();
  });

  it("names the earlier action before an open choice, and knows nothing of an unknown action", () => {
    const t = thread("t1", LAUNCH, [choice(), action("x", "Pick the list"), action("y", "Send")]);
    expect(actionWaits([t], t, "y")).toBe("Waits on “Pick the list”");
    expect(actionWaits([t], t, "nope")).toBeNull();
  });
});
