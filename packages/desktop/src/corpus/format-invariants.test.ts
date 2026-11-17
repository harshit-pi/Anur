// Bold, italic and strikethrough on real text: thousands of selections over
// every corpus text, many starting or ending inside hidden marks. Each flip
// must keep the visible text exactly, give every selected character the same
// style, and leave every other character's style as it was.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { describe, expect, it } from "vitest";
import { flipStyle, type Style } from "../renderer/src/editor/inline-format.ts";
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

const NODE_STYLE: Record<string, Style> = {
  StrongEmphasis: "bold",
  Emphasis: "italic",
  Strikethrough: "strike",
};
const ATOMS = new Set([
  "Link",
  "Image",
  "InlineCode",
  "WikiLink",
  "WikiEmbed",
  "Autolink",
  "URL",
  "HTMLTag",
  "Escape",
  "Entity",
]);

type Char = { ch: string; pos: number; styles: Set<Style>; atom: number | null };

/** The text as shown: marks left out, each character with its styles and the atom it sits in. */
function visible(state: EditorState, from: number, to: number): Char[] {
  // The whole parse, not whatever part is done: an unparsed stretch shows its marks.
  const tree = ensureSyntaxTree(state, state.doc.length, 10_000) ?? syntaxTree(state);
  const marks: [number, number][] = [];
  const styled: { from: number; to: number; s: Style }[] = [];
  const atoms: [number, number][] = [];
  tree.iterate({
    from,
    to,
    enter(n) {
      if (n.name === "EmphasisMark" || n.name === "StrikethroughMark") marks.push([n.from, n.to]);
      const s = NODE_STYLE[n.name];
      if (s) styled.push({ from: n.from, to: n.to, s });
      if (ATOMS.has(n.name)) {
        atoms.push([n.from, n.to]);
        return false;
      }
      return undefined;
    },
  });
  const out: Char[] = [];
  for (let pos = from; pos < to; pos++) {
    if (marks.some(([a, b]) => a <= pos && pos < b)) continue;
    const atom = atoms.findIndex(([a, b]) => a <= pos && pos < b);
    out.push({
      ch: state.sliceDoc(pos, pos + 1),
      pos,
      styles: new Set(styled.filter((x) => x.from <= pos && pos < x.to).map((x) => x.s)),
      atom: atom >= 0 ? atom : null,
    });
  }
  return out;
}

/** A small seeded random number generator, so failures repeat. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

describe("formatting on the corpus", () => {
  const styles: Style[] = ["bold", "italic", "strike"];
  it(`keeps visible text and flips only the selection, over ${String(texts.length)} texts`, () => {
    const random = rng(7);
    let checked = 0;
    let declined = 0;
    const declinedExamples: string[] = [];
    const failures: string[] = [];
    for (const text of texts) {
      const state = EditorState.create({ doc: text, extensions: [markdownSupport()] });
      const tree = ensureSyntaxTree(state, state.doc.length, 10_000) ?? syntaxTree(state);
      /** Inside a code block, where formatting has no meaning and is declined. */
      const inCode = (pos: number) => {
        for (let n: SyntaxNode | null = tree.resolveInner(pos, 1); n; n = n.parent) {
          if (/^(FencedCode|CodeBlock|HTMLBlock|Table|Frontmatter)$/.test(n.name)) return true;
        }
        return false;
      };
      syntaxTree(state);
      const lines = [];
      for (let n = 1; n <= state.doc.lines; n++) {
        const l = state.doc.line(n);
        // Prose lines: not headings, tables, fences, lists' markers or frontmatter.
        if (/^\s*(#|\||```|~~~|---|>|- |\* |\d+\.|[a-z_]+:)/i.test(l.text)) continue;
        if (l.text.trim().split(/\s+/).length >= 3 && !inCode(l.from)) lines.push(l);
      }
      for (let k = 0; k < 6 && lines.length; k++) {
        const line = lines[Math.floor(random() * lines.length)];
        if (!line) continue;
        const a = line.from + Math.floor(random() * line.length);
        const b = line.from + Math.floor(random() * line.length);
        const [from, to] = a <= b ? [a, b] : [b, a];
        if (to - from < 2 || text.slice(from, to).trim() === "") continue;
        for (const style of styles) {
          const st = EditorState.create({
            doc: text,
            selection: EditorSelection.range(from, to),
            extensions: [markdownSupport()],
          });
          const before = visible(st, line.from, line.to);
          const after = st.update({ changes: flipStyle(st, style) }).state;
          const newLine = after.doc.line(st.doc.lineAt(from).number);
          const now = visible(after, newLine.from, newLine.to);
          checked++;
          const where = `${style} on ${JSON.stringify(line.text.slice(from - line.from, to - line.from))} in ${JSON.stringify(line.text)}`;
          if (now.map((c) => c.ch).join("") !== before.map((c) => c.ch).join("")) {
            failures.push(`visible text changed: ${where} → ${JSON.stringify(newLine.text)}`);
            continue;
          }
          if (after.doc.eq(st.doc)) {
            // Declined, as inside a code block, or where no valid marks exist.
            declined++;
            if (declinedExamples.length < 12) {
              declinedExamples.push(
                `${style}: ${JSON.stringify(text.slice(from, to))} | ${JSON.stringify(line.text.slice(0, 160))}`,
              );
            }
            continue;
          }
          const touchedAtoms = new Set(
            before.filter((c) => c.pos >= from && c.pos < to && c.atom !== null).map((c) => c.atom),
          );
          // Where marks can't sit beside punctuation, the selection may grow to whole tokens.
          const word = /\S/u;
          let wideFrom = from;
          let wideTo = to;
          while (wideFrom > line.from && word.test(text.slice(wideFrom - 1, wideFrom))) wideFrom--;
          while (wideTo < line.to && word.test(text.slice(wideTo, wideTo + 1))) wideTo++;
          const maybe = (c: Char) => c.pos >= wideFrom && c.pos < wideTo;
          const selected = (c: Char) =>
            (c.pos >= from && c.pos < to) || (c.atom !== null && touchedAtoms.has(c.atom));
          const chosen = before
            .map((c, i) => [c, now[i]] as const)
            .filter(([c]) => selected(c) && !/\s/.test(c.ch));
          if (chosen.length === 0) continue;
          const target = !chosen.every(([c]) => c.styles.has(style));
          if (chosen.some(([, n]) => n?.styles.has(style) !== target)) {
            failures.push(
              `selection not uniformly ${target ? "on" : "off"}: ${where} → ${JSON.stringify(newLine.text)}`,
            );
          }
          const others = before
            .map((c, i) => [c, now[i]] as const)
            .filter(([c]) => !selected(c) && !maybe(c) && !/\s/.test(c.ch));
          if (others.some(([c, n]) => c.styles.has(style) !== n?.styles.has(style))) {
            failures.push(
              `text outside the selection changed: ${where} → ${JSON.stringify(newLine.text)}`,
            );
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1500);
    // Declining is for code blocks and impossible marks, not ordinary prose.
    // Declining is for impossible marks, not ordinary prose.
    expect(declined / checked, declinedExamples.join("\n")).toBeLessThan(0.05);
    expect(failures.slice(0, 8)).toEqual([]);
  }, 180_000);
});
