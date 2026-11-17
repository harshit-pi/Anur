import { describe, expect, it } from "vitest";
import { inlineRuns, splitMatches } from "./inline-markdown.ts";

const show = (line: string) =>
  inlineRuns(line).map((r) => (r.marks.length ? `${r.text}<${r.marks.join("+")}>` : r.text));

describe("inlineRuns", () => {
  it("drops the marks and keeps the styles, nested", () => {
    expect(show("- ~~**Cross-functional ask router**~~ → test")).toEqual([
      "Cross-functional ask router<strike+bold>",
      " → test",
    ]);
  });

  it("drops heading, quote, numbered and task markers", () => {
    expect(show("## Plan")).toEqual(["Plan"]);
    expect(show("> quoted")).toEqual(["quoted"]);
    expect(show("3. third")).toEqual(["third"]);
    expect(show("- [x] done")).toEqual(["done"]);
  });

  it("shows links by their text", () => {
    expect(show("see [[Folder/Plan#Goals|the plan]] and [docs](https://x.y)")).toEqual([
      "see ",
      "the plan<link>",
      " and ",
      "docs<link>",
    ]);
    expect(show("[[Folder/Plan]]")).toEqual(["Plan<link>"]);
  });

  it("keeps code as written, and snake_case and lone stars as they are", () => {
    expect(show("run `a **b**` now")).toEqual(["run ", "a **b**<code>", " now"]);
    expect(show("my_var_name and 2 * 3 * 4")).toEqual(["my_var_name and 2 * 3 * 4"]);
  });

  it("italic and highlight", () => {
    expect(show("*one* _two_ ==three==")).toEqual([
      "one<italic>",
      " ",
      "two<italic>",
      " ",
      "three<highlight>",
    ]);
  });
});

describe("splitMatches", () => {
  it("marks each match, any case", () => {
    expect(splitMatches("Monday and monday", "MONDAY")).toEqual([
      { text: "Monday", match: true },
      { text: " and ", match: false },
      { text: "monday", match: true },
    ]);
  });
});
