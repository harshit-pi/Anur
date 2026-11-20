import { describe, expect, it } from "vitest";
import { choiceActs, choicePress, type OptionSet } from "./map-acts.ts";

const set = (o: Partial<OptionSet> = {}): OptionSet => ({
  heading: "Retry strategy",
  used: null,
  added: [],
  explored: [],
  options: [{ id: "a" }, { id: "b" }],
  ...o,
});

describe("a choice's buttons on the map (30.32)", () => {
  it("offers Use and Explore, as its card does", () => {
    expect(choiceActs({})).toEqual({ use: "Use", explore: true });
  });

  it("says Use instead on one passed over, Add on a part, and no Explore once explored", () => {
    expect(choiceActs({ notPicked: true })).toEqual({ use: "Use instead", explore: true });
    expect(choiceActs({ several: true })).toEqual({ use: "Add", explore: false });
    expect(choiceActs({ explored: true })).toEqual({ use: "Use", explore: false });
  });

  it("offers nothing while the agent is exploring it", () => {
    expect(choiceActs({ exploring: true })).toBeNull();
  });
});

describe("pressing one (30.32)", () => {
  it("puts the choice under its decision's heading, as the card's Use does", () => {
    expect(choicePress(set(), "a", "use")).toEqual({
      kind: "use",
      how: "replace",
      heading: "Retry strategy",
    });
  });

  it("switches to one passed over, and does nothing for the one already picked", () => {
    expect(choicePress(set({ used: "a" }), "b", "use")).toMatchObject({ kind: "use" });
    expect(choicePress(set({ used: "a" }), "a", "use")).toBeNull();
  });

  it("adds a part as its own subsection, once", () => {
    const parts = set({ several: true, heading: null });
    expect(choicePress(parts, "a", "use")).toEqual({
      kind: "use",
      how: "subsection",
      heading: null,
    });
    expect(choicePress({ ...parts, added: ["a"] }, "a", "use")).toBeNull();
  });

  it("explores one not explored yet, and ignores an option not in the set", () => {
    expect(choicePress(set(), "a", "explore")).toEqual({ kind: "explore" });
    expect(choicePress(set({ explored: ["a"] }), "a", "explore")).toBeNull();
    expect(choicePress(set(), "z", "use")).toBeNull();
  });
});
