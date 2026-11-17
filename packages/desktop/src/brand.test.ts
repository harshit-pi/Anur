// Keeps brand/tokens.css readable: every text colour passes WCAG AA on the
// page and the app background, and every state colour on its own wash,
// in both themes.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../../brand/tokens.css", import.meta.url), "utf8");

const tokens = new Map<string, { light: string; dark: string }>();
for (const m of css.matchAll(
  /--([\w-]+):\s*light-dark\(\s*(#[0-9a-f]{6})\s*,\s*(#[0-9a-f]{6})\s*\)/gi,
)) {
  const [, name, light, dark] = m;
  if (name && light && dark) tokens.set(name, { light, dark });
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function get(name: string, theme: "light" | "dark"): string {
  const t = tokens.get(name);
  if (!t) throw new Error(`missing token --${name}`);
  return t[theme];
}

const TEXT = ["ink", "ink2", "slate", "graphite", "blue", "green", "amber", "red"];
const STATES = ["blue", "green", "amber", "red"];

describe.each(["light", "dark"] as const)("%s theme", (theme) => {
  it.each(TEXT.flatMap((fg) => ["sheet", "paper"].map((bg) => [fg, bg] as const)))(
    "--%s on --%s passes AA",
    (fg, bg) => {
      expect(contrast(get(fg, theme), get(bg, theme))).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(STATES)("--%s on its wash passes AA", (state) => {
    expect(contrast(get(state, theme), get(`${state}-wash`, theme))).toBeGreaterThanOrEqual(4.5);
  });
});
