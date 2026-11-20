// 30.30: a choice card's text used to open on hover, which pushed Use, Add as subsection and
// Explore this down from under the pointer, so the first click missed. The text opens on a
// click now, and nothing in the card may change size on hover.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./renderer/src/app.css", import.meta.url), "utf8");

describe("a choice card in the thread panel", () => {
  it("does not open its text on hover", () => {
    expect(css).not.toMatch(/\.think-offer:hover[^{]*\.think-offer-text/);
  });

  it("opens its text from a class set by a click", () => {
    expect(css).toMatch(/\.think-offer-text\.open/);
  });

  it("has no size-changing rule on hover anywhere in the card", () => {
    const hover = [...css.matchAll(/(\.think-offer[^{,]*:hover[^{]*)\{([^}]*)\}/g)];
    for (const [, selector = "", body = ""] of hover) {
      expect(body, `${selector} must not change size`).not.toMatch(
        /(max-height|height|padding|margin|display)\s*:/,
      );
    }
  });
});
