import { describe, expect, it } from "vitest";
import { loadPageFont } from "./font-pref.ts";

const store = (v: string | null) => ({ getItem: () => v });

describe("page font", () => {
  it("is the serif unless sans or system was picked", () => {
    expect(loadPageFont(store(null))).toBe("serif");
    expect(loadPageFont(store("sans"))).toBe("sans");
    expect(loadPageFont(store("system"))).toBe("system");
    expect(loadPageFont(store("comic"))).toBe("serif");
  });
});
