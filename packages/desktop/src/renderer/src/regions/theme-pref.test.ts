import { describe, expect, it } from "vitest";
import { loadTheme, saveTheme } from "./theme-pref.ts";

const store = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => m.set(k, v),
  };
};

describe("the theme preference", () => {
  it("follows the system until a theme is picked, then remembers it", () => {
    const s = store();
    expect(loadTheme(s)).toBe("system");
    saveTheme(s, "dark");
    expect(loadTheme(s)).toBe("dark");
  });

  it("reads anything unknown, or blocked storage, as the system's", () => {
    expect(loadTheme({ getItem: () => "purple" })).toBe("system");
    expect(
      loadTheme({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBe("system");
  });
});
