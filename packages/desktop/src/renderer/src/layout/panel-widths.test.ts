import { describe, expect, it } from "vitest";
import {
  PANEL,
  clampWidth,
  dragged,
  initialWidths,
  loadWidths,
  saveWidths,
} from "./panel-widths.ts";

function memory() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
}

describe("sidebar widths", () => {
  it("grow the left panel when dragged right, and the right panel when dragged left", () => {
    expect(dragged("left", 260, 300, 340)).toBe(300);
    expect(dragged("right", 300, 1200, 1150)).toBe(350);
  });

  it("stay within their bounds", () => {
    expect(dragged("left", 260, 300, -1000)).toBe(PANEL.left.min);
    expect(dragged("left", 260, 300, 5000)).toBe(PANEL.left.max);
    expect(clampWidth("right", Number.NaN)).toBe(PANEL.right.initial);
  });

  it("are remembered, and anything odd in storage falls back to the defaults", () => {
    const s = memory();
    saveWidths(s, { left: 320, right: 360 });
    expect(loadWidths(s)).toEqual({ left: 320, right: 360 });
    s.setItem("anur.panelWidths", "not json");
    expect(loadWidths(s)).toEqual(initialWidths());
    s.setItem("anur.panelWidths", JSON.stringify({ left: 9999, right: 1 }));
    expect(loadWidths(s)).toEqual({ left: PANEL.left.max, right: PANEL.right.min });
    expect(loadWidths(undefined)).toEqual(initialWidths());
  });

  it("survive storage that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadWidths(broken)).toEqual(initialWidths());
    expect(() => {
      saveWidths(broken, initialWidths());
    }).not.toThrow();
  });
});
