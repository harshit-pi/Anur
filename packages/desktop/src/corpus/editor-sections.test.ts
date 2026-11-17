// The page's sections come from the editor's own parse; core parses closed
// files itself. They must never disagree (Data Model, "From file to sections
// to map"), so every corpus text is checked both ways.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EditorState } from "@codemirror/state";
import { buildSectionTree } from "@anur/core";
import { describe, expect, it } from "vitest";
import { markdownSupport, sectionsOf } from "../renderer/src/editor/sections.ts";

const DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "corpora",
  "sections",
);
const texts = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .flatMap((f) => {
    const c = JSON.parse(readFileSync(path.join(DIR, f), "utf8")) as {
      before: string;
      after: string;
    };
    return [
      [`${f} before`, c.before],
      [`${f} after`, c.after],
    ] as const;
  });

const SAMPLE = [
  "---",
  "title: Retry",
  "---",
  "# Failed-payment notifications",
  "",
  "See [[Personas#Solo freelancer|freelancers]].",
  "",
  "```md",
  "## Not a heading",
  "```",
  "",
  "## Retry timing",
  "",
  "> [!note] Callout",
  "> ## Not a section",
  "",
  "Setext heading",
  "--------------",
  "",
  "### Notes",
  "",
].join("\n");

const shape = (t: ReturnType<typeof buildSectionTree>) =>
  t.sections.map((s) => ({
    path: s.path,
    level: s.level,
    own: s.ownRange,
    subtree: s.subtreeRange,
    links: s.linksOut.length,
  }));

describe("the editor's sections", () => {
  it("match core's for a doc with every kind of edge", () => {
    const state = EditorState.create({ doc: SAMPLE, extensions: [markdownSupport()] });
    expect(shape(sectionsOf(state, "doc.md"))).toEqual(
      shape(buildSectionTree(SAMPLE, { fileName: "doc.md" })),
    );
  });

  it.each(texts)("match core's: %s", (_, text) => {
    const state = EditorState.create({ doc: text, extensions: [markdownSupport()] });
    expect(shape(sectionsOf(state, "doc.md"))).toEqual(
      shape(buildSectionTree(text, { fileName: "doc.md" })),
    );
  });
});
