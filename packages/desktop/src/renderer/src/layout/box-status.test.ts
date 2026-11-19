import { describe, expect, it } from "vitest";
import { boxStatus } from "./box-status.ts";

type T = Parameters<typeof boxStatus>[0][number];
const t = (more: Partial<T> = {}): T => ({
  busy: false,
  closed: false,
  purpose: null,
  items: [],
  ...more,
});
const offers = (used: string | null) =>
  ({
    kind: "options",
    turn: "t",
    options: [
      { id: "a", title: "Free stock", text: "" },
      { id: "b", title: "Cash", text: "" },
    ],
    used,
    explored: [],
    within: null,
  }) as T["items"][number];

describe("what a box says happened on it (mock 9)", () => {
  it("puts what waits on the person first, then work under way, then what was settled", () => {
    expect(boxStatus([t({ items: [offers(null)] })], 0)).toEqual({
      label: "2 options",
      tone: "blue",
    });
    expect(boxStatus([t()], 1)).toEqual({ label: "Edit to use", tone: "blue" });
    expect(boxStatus([t({ busy: true, purpose: "build" })], 0)?.label).toBe("Building…");
    expect(boxStatus([t({ items: [offers("a")] })], 0)).toEqual({
      label: "Picked: Free stock",
      tone: "green",
    });
    expect(boxStatus([], 0)).toBeNull();
  });

  it("says what a Build made and what a Check found", () => {
    const made = (id: string, undone = false) =>
      ({ kind: "created", id, doc: `${id}.md`, undoable: true, undone }) as T["items"][number];
    expect(
      boxStatus([t({ purpose: "build", items: [made("a"), made("b"), made("c", true)] })], 0),
    ).toEqual({
      label: "Built · 2 docs",
      tone: "green",
    });
    const check = (verdicts: ("holds" | "missing")[]) =>
      ({
        kind: "check",
        turn: "t",
        claims: verdicts.map((verdict) => ({ claim: "x", verdict, source: "", note: "" })),
        corrected: false,
      }) as T["items"][number];
    expect(boxStatus([t({ purpose: "check", items: [check(["holds", "missing"])] })], 0)).toEqual({
      label: "Check: 1 to look at",
      tone: "amber",
    });
    expect(boxStatus([t({ purpose: "check", items: [check(["holds"])] })], 0)?.label).toBe(
      "Checked",
    );
  });
});
