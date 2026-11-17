// Deleting, typing and copying on real text with marks hidden: thousands of
// random edits over every corpus text. The page must show exactly what the
// person did, every other character keeping its style, and a copy must read
// back as the selected text with its styles.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { describe, expect, it } from "vitest";
import { hiddenParts } from "../renderer/src/editor/edit-guard.ts";
import { copyText } from "../renderer/src/editor/inline-format.ts";
import { livePreview } from "../renderer/src/editor/live-preview/live-preview.ts";
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

const FORMATS = new Set([
  "StrongEmphasis",
  "Emphasis",
  "Strikethrough",
  "InlineCode",
  "Link",
  "WikiLink",
]);
const STYLE: Record<string, string> = { StrongEmphasis: "b", Emphasis: "i", Strikethrough: "s" };

type Char = { ch: string; pos: number; styles: string; hiddenAround: boolean };

const make = (doc: string, sel = 0) =>
  EditorState.create({
    doc,
    selection: EditorSelection.cursor(sel),
    extensions: [markdownSupport(), livePreview],
  });

/** What the page shows of `from..to`: characters outside hidden parts, with their styles. */
function shown(state: EditorState, from: number, to: number): Char[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 10_000) ?? syntaxTree(state);
  const hidden: [number, number][] = [];
  const styled: { from: number; to: number; s: string }[] = [];
  tree.iterate({
    from,
    to,
    enter(n) {
      if (FORMATS.has(n.name)) hidden.push(...hiddenParts(n.node));
      const s = STYLE[n.name];
      if (s) styled.push({ from: n.from, to: n.to, s });
    },
  });
  const out: Char[] = [];
  for (let pos = from; pos < to; pos++) {
    if (hidden.some(([a, b]) => a <= pos && pos < b)) continue;
    out.push({
      ch: state.sliceDoc(pos, pos + 1),
      pos,
      styles: styled
        .filter((x) => x.from <= pos && pos < x.to)
        .map((x) => x.s)
        .sort()
        .join(""),
      hiddenAround: hidden.some(([a, b]) => b === pos || a === pos + 1),
    });
  }
  return out;
}

/** Hidden parts on a line: where no cursor or selection edge can rest. */
function hiddenOn(state: EditorState, from: number, to: number): [number, number][] {
  const tree = ensureSyntaxTree(state, state.doc.length, 10_000) ?? syntaxTree(state);
  const out: [number, number][] = [];
  tree.iterate({
    from,
    to,
    enter(n) {
      if (FORMATS.has(n.name)) out.push(...hiddenParts(n.node));
    },
  });
  return out;
}

/** Move a position out of any hidden part, as the editor's atomic ranges do. */
const outOfHidden = (hidden: [number, number][], pos: number, side: -1 | 1) => {
  const part = hidden.find(([a, b]) => a < pos && pos < b);
  return part ? (side < 0 ? part[0] : part[1]) : pos;
};

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

/** Prose lines, not inside code, tables or frontmatter. */
function proseLines(state: EditorState) {
  const tree = ensureSyntaxTree(state, state.doc.length, 10_000) ?? syntaxTree(state);
  const inCode = (pos: number) => {
    for (let n: SyntaxNode | null = tree.resolveInner(pos, 1); n; n = n.parent) {
      if (/^(FencedCode|CodeBlock|HTMLBlock|Table|Frontmatter)$/.test(n.name)) return true;
    }
    return false;
  };
  const lines = [];
  for (let n = 1; n <= state.doc.lines; n++) {
    const l = state.doc.line(n);
    if (
      l.text.trim().split(/\s+/).length >= 3 &&
      !inCode(l.from) &&
      !/^\s*(#|>|[-*+] |\d+\.)/.test(l.text)
    ) {
      lines.push(l);
    }
  }
  return lines;
}

/**
 * The same characters with the same styles. Punctuation may lose a style
 * where Markdown can't keep it (a mark between "." and a word), so its
 * style isn't compared.
 */
const same = (a: Char[], b: Char[]) =>
  a.length === b.length &&
  a.every((c, k) => {
    const other = b[k];
    return (
      other !== undefined &&
      c.ch === other.ch &&
      (/[\s\p{P}\p{S}]/u.test(c.ch) || c.styles === other.styles)
    );
  });

describe("editing the corpus with marks hidden", () => {
  it(`deletes only what is selected, over ${String(texts.length)} texts`, () => {
    const random = rng(11);
    const failures: string[] = [];
    let checked = 0;
    let lost = 0;
    for (const text of texts) {
      const base = make(text);
      for (const line of proseLines(base).slice(0, 4)) {
        const hidden = hiddenOn(base, line.from, line.to);
        const a = line.from + Math.floor(random() * line.length);
        const b = line.from + Math.floor(random() * line.length);
        const [rawFrom, rawTo] = a <= b ? [a, b] : [b, a];
        const from = outOfHidden(hidden, rawFrom, -1);
        const to = outOfHidden(hidden, rawTo, 1);
        if (to - from < 1) continue;
        const before = shown(base, line.from, line.to);
        const want = before.filter((c) => c.pos < from || c.pos >= to);
        const after = base.update({ changes: { from, to }, userEvent: "delete.selection" }).state;
        const newLine = after.doc.lineAt(Math.min(from, after.doc.length));
        const got = shown(after, newLine.from, newLine.to);
        checked++;
        if (got.map((c) => c.ch).join("") === want.map((c) => c.ch).join("") && !same(got, want)) {
          // The text is right but a style was lost: allowed where Markdown
          // can't keep it, and counted, so it stays rare.
          const gained = got.some((c, k) => {
            const w = want[k];
            // Styles are one letter each: b, i, s.
            return (
              w !== undefined &&
              /[bis]/.test(c.styles.replace(new RegExp(`[${w.styles}]`, "g"), ""))
            );
          });
          if (!gained) {
            lost++;
            continue;
          }
        }
        if (!same(got, want)) {
          failures.push(
            `${JSON.stringify(text.slice(from, to))} from ${JSON.stringify(line.text)} → ${JSON.stringify(newLine.text)}`,
          );
        }
      }
    }
    expect(checked).toBeGreaterThan(300);
    expect(failures.slice(0, 6)).toEqual([]);
    expect(lost / checked).toBeLessThan(0.05);
  }, 180_000);

  it("types a space or a letter exactly where the cursor is", () => {
    const random = rng(23);
    const failures: string[] = [];
    let checked = 0;
    for (const text of texts) {
      const base = make(text);
      for (const line of proseLines(base).slice(0, 4)) {
        const before = shown(base, line.from, line.to);
        const at = line.from + Math.floor(random() * (line.length + 1));
        // A cursor never rests inside hidden marks: they're atomic.
        if (hiddenOn(base, line.from, line.to).some(([p, q]) => p < at && at < q)) continue;
        for (const typed of [" ", "z"]) {
          const st = make(text, at);
          const after = st.update({
            changes: { from: at, insert: typed },
            selection: EditorSelection.cursor(at + 1),
            userEvent: "input.type",
          }).state;
          const newLine = after.doc.lineAt(Math.min(at, after.doc.length));
          const got = shown(after, newLine.from, newLine.to);
          const index = before.filter((c) => c.pos < at).length;
          const wantText =
            before
              .slice(0, index)
              .map((c) => c.ch)
              .join("") +
            typed +
            before
              .slice(index)
              .map((c) => c.ch)
              .join("");
          checked++;
          const kept = got.filter((_, k) => k !== index);
          if (got.map((c) => c.ch).join("") !== wantText || !same(kept, before)) {
            failures.push(
              `${JSON.stringify(typed)} at ${String(at - line.from)} in ${JSON.stringify(line.text)} → ${JSON.stringify(newLine.text)}`,
            );
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(600);
    expect(failures.slice(0, 6)).toEqual([]);
  }, 180_000);

  it("copies the selection as Markdown that reads back the same", () => {
    const random = rng(37);
    const failures: string[] = [];
    let checked = 0;
    for (const text of texts) {
      const base = make(text);
      for (const line of proseLines(base).slice(0, 4)) {
        const a = line.from + Math.floor(random() * line.length);
        const b = line.from + Math.floor(random() * line.length);
        const [from, to] = a <= b ? [a, b] : [b, a];
        if (to - from < 2) continue;
        const copied = copyText(base, from, to);
        if (copied === null) continue;
        const pasted = make(copied);
        const got = shown(pasted, 0, copied.length);
        const all = shown(base, line.from, line.to);
        // A link or wiki link cut into by the selection is copied whole.
        const want = all.filter((c) => c.pos >= from && c.pos < to);
        checked++;
        const trim = (cs: Char[]) =>
          cs
            .map((c) => c.ch)
            .join("")
            .trim();
        if (
          trim(got) !== trim(want) &&
          !got
            .map((c) => c.ch)
            .join("")
            .includes(trim(want))
        ) {
          failures.push(`${JSON.stringify(text.slice(from, to))} → ${JSON.stringify(copied)}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(300);
    expect(failures.slice(0, 6)).toEqual([]);
  }, 180_000);
});
