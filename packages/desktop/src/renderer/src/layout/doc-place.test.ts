import { describe, expect, it } from "vitest";
import { loadPlace, savePlace, sectionIndexOf } from "./doc-place.ts";

function memory() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
  };
}

describe("where a doc was left", () => {
  it("keeps each doc's view and section, per space", () => {
    const s = memory();
    savePlace(s, "/a", "Plan.md", { view: "map", section: ["Plan", "Launch"] });
    savePlace(s, "/a", "Notes.md", { view: "page", section: ["Notes"] });
    expect(loadPlace(s, "/a", "Plan.md")).toEqual({ view: "map", section: ["Plan", "Launch"] });
    expect(loadPlace(s, "/b", "Plan.md")).toBeNull();
    expect(loadPlace(s, "/a", "Other.md")).toBeNull();
  });

  it("finds the section again by its heading path, or says it's gone", () => {
    const sections = [{ path: ["Plan"] }, { path: ["Plan", "Launch"] }];
    expect(sectionIndexOf(sections, ["Plan", "Launch"])).toBe(1);
    expect(sectionIndexOf(sections, ["Plan", "Pricing"])).toBe(-1);
  });
});
