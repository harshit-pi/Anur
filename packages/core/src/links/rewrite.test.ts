import { describe, expect, it } from "vitest";
import { docsBefore, rewriteLinks, type Move } from "./rewrite.ts";

const before = ["Home.md", "Ideas/Plan.md", "Ideas/Gift.md", "Archive/Old.md"];
const apply = (moves: Move[]) => ({
  moves,
  after: [...before.filter((d) => !moves.some((m) => m.from === d)), ...moves.map((m) => m.to)],
});

function run(text: string, was: string, moves: Move[]) {
  const { after } = apply(moves);
  const now = moves.find((m) => m.from === was)?.to ?? was;
  return rewriteLinks(text, was, now, moves, before, after);
}

describe("links after a rename or move", () => {
  it("renames wiki links by name, keeping heading, alias and embeds", () => {
    const moves = [{ from: "Ideas/Plan.md", to: "Ideas/Roadmap.md" }];
    const r = run(
      "See [[Plan]], [[Plan#Risks|the risks]], ![[Plan]] and [[Ideas/Plan]].",
      "Home.md",
      moves,
    );
    expect(r.text).toBe(
      "See [[Roadmap]], [[Roadmap#Risks|the risks]], ![[Roadmap]] and [[Ideas/Roadmap]].",
    );
    expect(r.changed).toBe(4);
  });

  it("leaves a name link alone when a move doesn't break it", () => {
    const moves = [{ from: "Ideas/Plan.md", to: "Archive/Plan.md" }];
    expect(run("[[Plan]]", "Home.md", moves)).toEqual({ text: "[[Plan]]", changed: 0 });
    expect(run("[[Ideas/Plan]]", "Home.md", moves).text).toBe("[[Archive/Plan]]");
  });

  it("uses the path when the bare name would find another doc", () => {
    const moves = [{ from: "Ideas/Plan.md", to: "Ideas/Old.md" }];
    expect(run("[[Plan]]", "Home.md", moves).text).toBe("[[Ideas/Old]]");
  });

  it("rewrites Markdown links relative to the linking doc, keeping .md, headings and encoding", () => {
    const moves = [{ from: "Ideas/Plan.md", to: "Archive/Next plan.md" }];
    expect(run("[p](Ideas/Plan.md#risks)", "Home.md", moves).text).toBe(
      "[p](Archive/Next%20plan.md#risks)",
    );
    expect(run("[p](Plan)", "Ideas/Gift.md", moves).text).toBe("[p](../Archive/Next%20plan)");
    expect(run("[p](<Plan.md>)", "Ideas/Gift.md", moves).text).toBe(
      "[p](<../Archive/Next plan.md>)",
    );
  });

  it("fixes the moved doc's own relative links", () => {
    const moves = [{ from: "Ideas/Plan.md", to: "Plan.md" }];
    expect(run("[g](Gift.md) and [[Gift]]", "Ideas/Plan.md", moves).text).toBe(
      "[g](Ideas/Gift.md) and [[Gift]]",
    );
  });

  it("follows every doc in a moved folder", () => {
    const moves = [
      { from: "Ideas/Plan.md", to: "Thoughts/Plan.md" },
      { from: "Ideas/Gift.md", to: "Thoughts/Gift.md" },
    ];
    expect(run("[[Ideas/Gift]] [x](Ideas/Plan.md)", "Home.md", moves).text).toBe(
      "[[Thoughts/Gift]] [x](Thoughts/Plan.md)",
    );
  });

  it("never touches code, web links, missing docs or other docs", () => {
    const moves = [{ from: "Ideas/Plan.md", to: "Ideas/Roadmap.md" }];
    const text = "`[[Plan]]`\n\n```\n[[Plan]]\n```\n\n[w](https://x.com/Plan.md) [[Nope]] [[Gift]]";
    expect(run(text, "Home.md", moves)).toEqual({ text, changed: 0 });
  });

  it("rebuilds the doc list from before the moves", () => {
    const moves = [{ from: "Ideas/Plan.md", to: "Ideas/Roadmap.md" }];
    expect(docsBefore(apply(moves).after, moves).sort()).toEqual([...before].sort());
  });
});
