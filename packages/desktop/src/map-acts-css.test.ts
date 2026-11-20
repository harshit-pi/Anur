// 30.32: Use and Explore on a choice, Build and Check on a section, in a
// toolbar on the box's edge. Showing it must never resize the box, or the
// map would shift under the pointer as it moves.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("the toolbar on a box", () => {
  const css = readFileSync(new URL("./renderer/src/app.css", import.meta.url), "utf8");
  const rule = (sel: string) =>
    new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ??
    "";

  it("floats on the box's edge, so showing it never grows the box", () => {
    expect(rule(".map-acts")).toMatch(/position:\s*absolute/);
    expect(rule(".map-acts")).toMatch(/display:\s*none/);
  });

  it("shows on a choice while hovered or picked, on a section only while hovered", () => {
    for (const sel of [
      ".map-option:hover > .map-acts",
      ".map-option.selected > .map-acts",
      ".map-box:hover > .map-acts",
    ])
      expect(css).toContain(sel);
    // A section is always selected: its Build and Check would never go away.
    expect(css).not.toContain(".map-box.selected > .map-acts");
  });
});
