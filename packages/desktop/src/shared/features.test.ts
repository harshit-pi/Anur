import { describe, expect, it } from "vitest";
import { DEFAULT_FLAGS, FEATURES, SWITCHABLE, flagsFrom, isSwitchable } from "./features.ts";

describe("the Core features registry", () => {
  it("keeps Page and map, and Think, always on; the rest switch", () => {
    expect(FEATURES.filter((f) => f.always).map((f) => f.id)).toEqual(["page-map", "think"]);
    expect(SWITCHABLE).toEqual(["links", "history", "actions"]);
    expect(isSwitchable("think")).toBe(false);
    expect(isSwitchable("history")).toBe(true);
  });

  it("reads saved switches, on by default, and the old history switch once", () => {
    expect(flagsFrom(undefined)).toEqual(DEFAULT_FLAGS);
    expect(flagsFrom({ actions: false, links: "no" })).toEqual({
      links: true,
      history: true,
      actions: false,
    });
    expect(flagsFrom(undefined, { sectionHistory: false }).history).toBe(false);
    // Once the registry has saved it, the new switch wins.
    expect(flagsFrom({ history: true }, { sectionHistory: false }).history).toBe(true);
  });
});
