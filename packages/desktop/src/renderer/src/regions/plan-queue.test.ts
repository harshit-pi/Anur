import { describe, expect, it } from "vitest";
import type { ThreadView } from "../../../shared/ipc-contract.ts";
import { advance, plannedOn } from "./plan-queue.ts";

type Item = ThreadView["items"][number];
const LAUNCH = ["Plan", "Launch"];

const thread = (id: string, items: Item[], extra: Partial<ThreadView> = {}): ThreadView => ({
  id,
  section: "s",
  path: LAUNCH,
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
const action = (id: string, run: string | null = null): Item => ({
  kind: "proposed-action",
  id,
  title: `Step ${id}`,
  what: `Do ${id}`,
  path: null,
  run,
});
const build = (id: string, state: "running" | "done" | "failed" | "stopped" | "needs") =>
  thread(id, [], { purpose: "build", action: { state, detail: "", ask: null } });
const plan = (runs: (string | null)[]) =>
  thread(
    "p",
    runs.map((r, i) => action(`a${String(i)}`, r)),
  );
const Q = ["a0", "a1", "a2"].map((action) => ({ thread: "p", action }));

describe("a plan run in order", () => {
  it("starts the first, then waits while it runs", () => {
    expect(advance(Q, [plan([null, null, null])])).toEqual({ queue: Q, run: Q[0] });
    const t = [plan(["b0", null, null]), build("b0", "running")];
    expect(advance(Q, t)).toEqual({ queue: Q, run: null });
  });

  it("starts each next one once the one before is done, and empties at the end", () => {
    const t = [plan(["b0", null, null]), build("b0", "done")];
    expect(advance(Q, t)).toEqual({ queue: Q.slice(1), run: Q[1] });
    const all = [
      plan(["b0", "b1", "b2"]),
      build("b0", "done"),
      build("b1", "done"),
      build("b2", "done"),
    ];
    expect(advance(Q, all)).toEqual({ queue: [], run: null });
  });

  it("pauses while a run waits on the person, and ends on a failure or a stop", () => {
    expect(advance(Q, [plan(["b0", null, null]), build("b0", "needs")]).queue).toEqual(Q);
    for (const state of ["failed", "stopped"] as const)
      expect(advance(Q, [plan(["b0", null, null]), build("b0", state)])).toEqual({
        queue: [],
        run: null,
      });
  });

  it("ends at a pick still to make", () => {
    const pick: Item = {
      kind: "options",
      turn: "u1",
      options: [
        { id: "x", title: "X", text: "" },
        { id: "y", title: "Y", text: "" },
      ],
      used: null,
      explored: [],
      within: null,
      heading: "Offer",
      several: false,
      added: [],
      skipped: [],
    };
    const t = thread("p", [pick, action("a0"), action("a1")]);
    expect(advance(Q.slice(0, 2), [t])).toEqual({ queue: [], run: null });
  });

  it("drops steps whose action is gone", () => {
    expect(advance([{ thread: "gone", action: "z" }, ...Q], [plan([null, null, null])])).toEqual({
      queue: Q,
      run: Q[0],
    });
  });

  it("lists a section's planned actions not yet run, in order", () => {
    expect(plannedOn([plan(["b0", null, null])], LAUNCH)).toEqual(Q.slice(1));
    expect(plannedOn([plan([null])], ["Plan", "Other"])).toEqual([]);
  });
});
