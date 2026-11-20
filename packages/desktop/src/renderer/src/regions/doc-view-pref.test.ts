import { describe, expect, it } from "vitest";
import { loadDocView } from "./doc-view-pref.ts";

describe("which view a doc opens in", () => {
  it("is the map unless the page was picked", () => {
    const at = (v: string | null) => ({ getItem: () => v });
    expect(loadDocView(at(null))).toBe("map");
    expect(loadDocView(at("page"))).toBe("page");
    expect(loadDocView(at("nonsense"))).toBe("map");
    expect(
      loadDocView({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBe("map");
  });
});
