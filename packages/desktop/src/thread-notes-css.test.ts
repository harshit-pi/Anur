// 30.34: a thread's notes on what it did to the docs (Used as it landed, Used all,
// Proposed, Made) read as plain text. Amber marks what waits on the person;
// these are done, so a bar or a wash on them only adds friction.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./renderer/src/app.css", import.meta.url), "utf8");
const rules = [...css.matchAll(/(\.think-changed[^{,]*)\{([^}]*)\}/g)];

describe("a thread's notes on what it did", () => {
  it("are styled somewhere", () => {
    expect(rules.length).toBeGreaterThan(0);
  });

  it("carry no background and no bar", () => {
    for (const [, selector = "", body = ""] of rules) {
      expect(body, `${selector} has a background`).not.toMatch(/background\s*:/);
      expect(body, `${selector} has a bar`).not.toMatch(/border(-left)?\s*:/);
    }
  });
});
