// Live preview must draw every real doc without two replacements overlapping,
// which CodeMirror can't show, and without touching the text. Every corpus
// text is checked with the cursor at the start and at the end.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { buildLivePreview } from "../renderer/src/editor/live-preview/live-preview.ts";
import { markdownSupport } from "../renderer/src/editor/sections.ts";

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
    return [c.before, c.after];
  });

/** Replacements that overlap one another, as "from-to" pairs. */
function overlaps(text: string, cursor: number): string[] {
  const state = EditorState.create({
    doc: text,
    selection: EditorSelection.cursor(cursor),
    extensions: [markdownSupport()],
  });
  const replaced: [number, number][] = [];
  buildLivePreview(state).between(0, text.length, (from, to, deco) => {
    if ((deco.spec as { class?: string }).class === undefined && to > from)
      replaced.push([from, to]);
  });
  replaced.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const bad: string[] = [];
  for (let i = 1; i < replaced.length; i++) {
    const prev = replaced[i - 1];
    const cur = replaced[i];
    if (prev && cur && cur[0] < prev[1])
      bad.push(
        `${JSON.stringify(text.slice(prev[0], prev[1]))} / ${JSON.stringify(text.slice(cur[0], cur[1]))}`,
      );
  }
  return bad;
}

describe("live preview on the corpus", () => {
  it(`draws all ${String(texts.length)} texts without overlapping replacements`, () => {
    for (const text of texts) {
      expect(overlaps(text, 0)).toEqual([]);
      expect(overlaps(text, text.length)).toEqual([]);
    }
  });
});
