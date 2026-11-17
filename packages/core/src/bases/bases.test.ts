import { describe, expect, it } from "vitest";
import { baseAsMarkdown, propertiesOf, readBase } from "./base.ts";
import { parseExpr } from "./expr.ts";
import type { NoteFacts } from "./values.ts";

const note = (path: string, properties: Record<string, unknown>): NoteFacts => ({
  path,
  properties,
  mtime: 0,
  ctime: 0,
  size: 0,
});

const NOTES = [
  note("Refined Ideas/Model/Model.md", {
    type: "idea",
    stage: "refined",
    status: "exploring",
    score_r1: 5.8,
    score_r2: 6.2,
    date: "2026-10-23",
    origin: "[[Visual Model]]",
    tags: ["idea", "ai"],
  }),
  note("Initial Ideas/Tieback/Tieback.md", {
    type: "idea",
    stage: "initial",
    status: "killed",
    score_r1: 4.8,
    score_r2: 5.4,
    date: "2026-11-14",
  }),
  note("Initial Ideas/Gift/Box.md", { type: "note", date: "2026-10-31" }),
  note("Initial Ideas/Visual Model.md", { type: "idea", status: "evaluated", score_r2: 7.1 }),
];

const BASE = `
filters:
  and:
    - 'note.type == "idea"'
formulas:
  shift: "note.score_r2 - note.score_r1"
properties:
  score_r2:
    displayName: Score
views:
  - type: table
    name: Refined
    filters:
      and:
        - file.inFolder("Refined Ideas")
    order: [file.name, score_r2, formula.shift, origin]
  - type: table
    name: Live
    filters:
      and:
        - 'note.status != "killed"'
        - "note.score_r2 >= 6"
    order: [file.name, score_r2]
    sort:
      - property: score_r2
        direction: DESC
  - type: table
    name: Graveyard
    filters:
      or:
        - 'note.status == "killed"'
        - file.hasTag("gone")
    order: [file.name, date]
`;

describe("an Obsidian base", () => {
  const r = readBase(BASE, NOTES);
  const names = (i: number) => r.views[i]?.rows.map((row) => row.cells[0]?.text);

  it("keeps the notes its filters keep, in each view", () => {
    expect(r.problems).toEqual([]);
    expect(r.views.map((v) => v.name)).toEqual(["Refined", "Live", "Graveyard"]);
    expect(names(0)).toEqual(["Model"]);
    expect(names(2)).toEqual(["Tieback"]);
  });

  it("sorts as it says, and labels columns by their display names", () => {
    expect(names(1)).toEqual(["Visual Model", "Model"]);
    expect(r.views[1]?.columns.map((c) => c.label)).toEqual(["Name", "Score"]);
  });

  it("works out formulas, and shows links as their names", () => {
    const cells = r.views[0]?.rows[0]?.cells;
    expect(cells?.map((c) => c.text)).toEqual(["Model", "6.2", "0.4", "Visual Model"]);
    expect(cells?.[0]?.link).toBe("Refined Ideas/Model/Model");
    expect(cells?.[3]?.link).toBe("Visual Model");
  });

  it("matches a link property against link()", () => {
    const base = `filters:\n  and:\n    - note["base"] == link("Task Tracker.base")\n`;
    const notes = [
      note("a.md", { base: "[[Task Tracker.base]]" }),
      note("b.md", { base: "[[Other]]" }),
    ];
    expect(readBase(base, notes).views[0]?.rows.map((x) => x.path)).toEqual(["a.md"]);
  });

  it("says what it couldn't read, and keeps every note for that filter", () => {
    const out = readBase(`filters:\n  and:\n    - "file.links.mystery(1)"\n`, NOTES);
    expect(out.problems.length).toBe(1);
    expect(out.views[0]?.rows.length).toBe(NOTES.length);
    expect(readBase("views: [", NOTES).problems[0]).toMatch(/valid YAML/);
  });

  it("writes a view as a Markdown table, for an agent's context", () => {
    const view = r.views[1];
    if (!view) throw new Error("no view");
    expect(baseAsMarkdown(view).split("\n").slice(0, 3)).toEqual([
      "| Name | Score |",
      "| --- | --- |",
      "| [[Initial Ideas/Visual Model\\|Visual Model]] | 7.1 |",
    ]);
  });
});

describe("reading notes and expressions", () => {
  it("reads a note's frontmatter, and nothing when there is none", () => {
    expect(propertiesOf("---\ntype: idea\nscore: 6\n---\n# Title")).toEqual({
      type: "idea",
      score: 6,
    });
    expect(propertiesOf("# Title\n---\nx: 1\n---")).toEqual({});
  });

  it("reads operators in the usual order", () => {
    expect(parseExpr("a + b * 2 >= 7 && !c")).toMatchObject({ kind: "binary", op: "&&" });
    expect(() => parseExpr('note.x == "open')).toThrow(/never closed/);
  });
});
