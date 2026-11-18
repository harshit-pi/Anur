import { EditorSelection, EditorState } from "@codemirror/state";
import type { Decoration } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { markdownSupport } from "../sections.ts";
import { buildLivePreview } from "./live-preview.ts";

/**
 * What the line being typed on looks like: its line styles, then its text
 * with hidden marks gone, widgets named and styled runs bracketed.
 */
function screen(doc: string): string {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(doc.length),
    extensions: [markdownSupport()],
  });
  const line = state.doc.lineAt(doc.length);
  const parts: { from: number; to: number; deco: Decoration }[] = [];
  buildLivePreview(state).between(line.from, line.to, (from, to, deco) => {
    parts.push({ from, to, deco });
  });
  const styles: string[] = [];
  let out = "";
  const marks: { from: number; to: number; cls: string }[] = [];
  const replaced: { from: number; to: number; widget: string }[] = [];
  for (const { from, to, deco } of parts) {
    const spec = deco.spec as {
      class?: string;
      widget?: { constructor: { name: string } };
      attributes?: unknown;
    };
    if (from === to && from === line.from && spec.class && !spec.widget) styles.push(spec.class);
    else if (spec.widget) replaced.push({ from, to, widget: `[${spec.widget.constructor.name}]` });
    else if (spec.class) marks.push({ from, to, cls: spec.class });
    else replaced.push({ from, to, widget: "" });
  }
  for (let pos = line.from; pos <= line.to; pos++) {
    for (const r of replaced) if (r.from === pos) out += r.widget;
    for (const m of marks) if (m.from === pos) out += `<${m.cls}>`;
    for (const m of marks) if (m.to === pos && m.from !== pos) out += `</${m.cls}>`;
    if (pos < line.to && !replaced.some((r) => r.from <= pos && pos < r.to))
      out += state.doc.sliceString(pos, pos + 1);
  }
  return `${styles.join(" ")}|${out}`;
}

/** What people type to start Markdown, one key at a time. */
const TYPED = [
  "# Plan",
  "## Plan",
  "### Plan",
  "**bold**",
  "*it*",
  "_it_",
  "`code`",
  "~~gone~~",
  "==mark==",
  "> said",
  "- item",
  "* item",
  "1. first",
  "- [ ] task",
  "[[Doc]]",
  "[a](b)",
];

describe("every keystroke shows", () => {
  it.each(TYPED)("typing %j changes what's on screen at every key", (typed) => {
    const start = "Intro.\n\n";
    let before = screen(start);
    for (let i = 1; i <= typed.length; i++) {
      const now = screen(start + typed.slice(0, i));
      expect(now, `after ${JSON.stringify(typed.slice(0, i))}`).not.toBe(before);
      before = now;
    }
  });
});
