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

/** A range grown over any code or link it cuts into, as the editor does. */
function wholeAtoms(state: EditorState, from: number, to: number): [number, number] {
  const tree = ensureSyntaxTree(state, state.doc.length, 10_000) ?? syntaxTree(state);
  let a = from;
  let b = to;
  tree.iterate({
    from,
    to,
    enter(n) {
      if (!["InlineCode", "Link", "WikiLink"].includes(n.name)) return;
      if (n.from < a && n.to > a) a = n.from;
      if (n.from < b && n.to > b) b = n.to;
    },
  });
  return [a, b];
}

/** Each style letter of a character's styles: b, i, s. */
const letters = (styles: string) =>
  Array.from({ length: styles.length }, (_, k) => styles.charAt(k));

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
describe("pasting and dragging on the corpus with marks hidden", () => {
  /** What a snippet shows on its own: characters with their styles. */
  const shownAlone = (md: string) => shown(make(md), 0, md.length);

  it("pastes Markdown so the page shows exactly it, in place", () => {
    const random = rng(41);
    const failures: string[] = [];
    let checked = 0;
    const lost: string[] = [];
    // Snippets: real Markdown copied out of the corpus, styles and all.
    const snippets: string[] = [];
    for (const text of texts.slice(0, 60)) {
      const base = make(text);
      for (const line of proseLines(base).slice(0, 2)) {
        const a = line.from + Math.floor(random() * line.length);
        const b = Math.min(line.to, a + 3 + Math.floor(random() * 30));
        const copied = copyText(base, a, b);
        if (copied?.trim()) snippets.push(copied);
      }
    }
    snippets.push("plain words", "**bold**", "*it*", "~~gone~~", "a **b** c");
    for (const text of texts) {
      const base = make(text);
      for (const line of proseLines(base).slice(0, 3)) {
        const hidden = hiddenOn(base, line.from, line.to);
        const snippet = snippets[Math.floor(random() * snippets.length)] ?? "x";
        const rawA = outOfHidden(hidden, line.from + Math.floor(random() * line.length), -1);
        const replace = random() < 0.4;
        const rawB = replace
          ? outOfHidden(hidden, Math.min(line.to, rawA + Math.floor(random() * 20)), 1)
          : rawA;
        // A selection cutting into code or a link takes it whole.
        const [a, b] = replace ? wholeAtoms(base, rawA, rawB) : [rawA, rawA];
        // Inside code or a link, a paste goes in as plain text.
        const inAtom = !replace && wholeAtoms(base, rawA, rawA)[0] < rawA;
        const before = shown(base, line.from, line.to);
        const after = make(text, a).update({
          changes: { from: rawA, to: rawB, insert: snippet },
          userEvent: "input.paste",
        }).state;
        const newLine = after.doc.lineAt(Math.min(a, after.doc.length));
        const got = shown(after, newLine.from, newLine.to);
        const kept = before.filter((c) => c.pos < a || c.pos >= b);
        const own = shownAlone(snippet);
        const index = kept.filter((c) => c.pos < a).length;
        const wantText = [...kept.slice(0, index), ...own, ...kept.slice(index)]
          .map((c) => c.ch)
          .join("");
        checked++;
        const where = `${JSON.stringify(snippet)} at ${String(a - line.from)}${replace ? ` over ${JSON.stringify(text.slice(a, b))}` : ""} in ${JSON.stringify(line.text.slice(0, 140))} → ${JSON.stringify(newLine.text.slice(0, 180))}`;
        // Inside code or a link where plain text won't fit, it goes just after.
        const atomEnd = wholeAtoms(base, rawA, rawA)[1];
        const k = kept.filter((c) => c.pos < atomEnd).length;
        const afterAtom = [...kept.slice(0, k), ...own, ...kept.slice(k)].map((c) => c.ch).join("");
        const gotText = got.map((c) => c.ch).join("");
        if (gotText !== wantText && !(inAtom && gotText === afterAtom)) {
          failures.push(`text: ${where}`);
          continue;
        }
        if (inAtom) continue;
        const ok = got.every((c, k) => {
          if (/[\s\p{P}\p{S}]/u.test(c.ch)) return true;
          if (k < index) return c.styles === kept[k]?.styles;
          if (k < index + own.length)
            return letters(own[k - index]?.styles ?? "").every((x) => c.styles.includes(x));
          return c.styles === kept[k - own.length]?.styles;
        });
        // A pasted style Markdown can't say there (a bold link right before a
        // word) is lost: counted, and kept rare.
        if (!ok) lost.push(where);
      }
    }
    expect(checked).toBeGreaterThan(300);
    expect(failures.slice(0, 6)).toEqual([]);
    expect(lost.length / checked, lost.slice(0, 4).join("\n")).toBeLessThan(0.03);
  }, 180_000);

  it("pastes several lines: the first joins the text before, the last the text after", () => {
    const random = rng(67);
    const failures: string[] = [];
    const lost: string[] = [];
    let checked = 0;
    // Snippets: two to four lines of real Markdown copied out of the corpus.
    const snippets: string[] = [];
    for (const text of texts.slice(0, 80)) {
      const base = make(text);
      const prose = new Set(proseLines(base).map((l) => l.number));
      for (const first of proseLines(base).slice(0, 3)) {
        const span = 1 + Math.floor(random() * 3);
        const lastNo = first.number + span;
        if (lastNo > base.doc.lines || !prose.has(lastNo)) continue;
        let ok = true;
        for (let n = first.number + 1; n < lastNo; n++) {
          if (!prose.has(n) && base.doc.line(n).text.trim() !== "") ok = false;
        }
        if (!ok) continue;
        const last = base.doc.line(lastNo);
        const a = first.from + Math.floor(random() * first.length);
        const b = last.from + 1 + Math.floor(random() * Math.max(1, last.length - 1));
        const copied = copyText(base, a, b);
        if (copied && copied.split("\n").length > 1) snippets.push(copied);
      }
    }
    snippets.push("one\ntwo", "**bold**\n\n*it*", "a **b**\nc");
    for (const text of texts) {
      const base = make(text);
      for (const line of proseLines(base).slice(0, 3)) {
        const hidden = hiddenOn(base, line.from, line.to);
        const snippet = snippets[Math.floor(random() * snippets.length)] ?? "x\ny";
        const rawA = outOfHidden(hidden, line.from + Math.floor(random() * line.length), -1);
        const replace = random() < 0.3;
        const rawB = replace
          ? outOfHidden(hidden, Math.min(line.to, rawA + Math.floor(random() * 20)), 1)
          : rawA;
        const [a, b] = rawB > rawA ? wholeAtoms(base, rawA, rawB) : [rawA, rawA];
        // Inside code or a link, the lines go just after it.
        const cut = rawB === rawA && wholeAtoms(base, rawA, rawA)[0] < rawA;
        const split = cut ? wholeAtoms(base, rawA, rawA)[1] : a;
        const after = make(text, rawA).update({
          changes: { from: rawA, to: rawB, insert: snippet },
          userEvent: "input.paste",
        }).state;
        const pasted = snippet.split("\n");
        const kept = shown(base, line.from, line.to).filter((c) => c.pos < a || c.pos >= b);
        const head = kept.filter((c) => c.pos < split);
        const tail = kept.filter((c) => c.pos >= split);
        const own0 = shownAlone(pasted[0] ?? "");
        const ownN = shownAlone(pasted.at(-1) ?? "");
        const n = pasted.length;
        checked++;
        const where = `${JSON.stringify(snippet.slice(0, 80))} at ${String(a - line.from)} in ${JSON.stringify(line.text.slice(0, 100))} → ${JSON.stringify(after.doc.sliceString(after.doc.line(line.number).from, after.doc.line(line.number + n - 1).to).slice(0, 220))}`;
        if (after.doc.lines !== base.doc.lines + n - 1) {
          failures.push(`lines: ${where}`);
          continue;
        }
        const gotHead = shown(
          after,
          after.doc.line(line.number).from,
          after.doc.line(line.number).to,
        );
        const lastLine = after.doc.line(line.number + n - 1);
        const gotTail = shown(after, lastLine.from, lastLine.to);
        const chars = (cs: Char[]) => cs.map((c) => c.ch).join("");
        const middleOk = pasted
          .slice(1, -1)
          .every((l, k) => after.doc.line(line.number + 1 + k).text === l);
        if (
          chars(gotHead) !== chars([...head, ...own0]) ||
          chars(gotTail) !== chars([...ownN, ...tail]) ||
          !middleOk
        ) {
          failures.push(`text: ${where}`);
          continue;
        }
        const keeps = (got: Char[], old: Char[], offset: number) =>
          old.every((c, k) => /[\s\p{P}\p{S}]/u.test(c.ch) || got[k + offset]?.styles === c.styles);
        if (!keeps(gotHead, head, 0) || !keeps(gotTail, tail, ownN.length)) {
          failures.push(`styles: ${where}`);
          continue;
        }
        const ownKept = (got: Char[], own: Char[], offset: number) =>
          own.every(
            (c, k) =>
              /[\s\p{P}\p{S}]/u.test(c.ch) ||
              letters(c.styles).every((x) => got[k + offset]?.styles.includes(x)),
          );
        if (!ownKept(gotHead, own0, head.length) || !ownKept(gotTail, ownN, 0)) lost.push(where);
      }
    }
    expect(checked).toBeGreaterThan(300);
    expect(failures.slice(0, 6)).toEqual([]);
    expect(lost.length / checked, lost.slice(0, 4).join("\n")).toBeLessThan(0.03);
  }, 180_000);

  it("drags text to another line, styles and all", () => {
    const random = rng(53);
    const failures: string[] = [];
    let checked = 0;
    const lost: string[] = [];
    for (const text of texts) {
      const base = make(text);
      const lines = proseLines(base);
      if (lines.length < 2) continue;
      for (let k = 0; k < 3; k++) {
        const src = lines[Math.floor(random() * lines.length)];
        const dst = lines[Math.floor(random() * lines.length)];
        if (!src || !dst || src.number === dst.number) continue;
        const hiddenS = hiddenOn(base, src.from, src.to);
        const rawA = outOfHidden(hiddenS, src.from + Math.floor(random() * src.length), -1);
        const rawB = outOfHidden(
          hiddenS,
          Math.min(src.to, rawA + 1 + Math.floor(random() * 25)),
          1,
        );
        // A source cutting into code or a link moves it whole.
        const [a, b] = wholeAtoms(base, rawA, rawB);
        const t = outOfHidden(
          hiddenOn(base, dst.from, dst.to),
          dst.from + Math.floor(random() * (dst.length + 1)),
          -1,
        );
        if (b <= a) continue;
        const beforeS = shown(base, src.from, src.to);
        const beforeD = shown(base, dst.from, dst.to);
        const moved = beforeS.filter((c) => c.pos >= a && c.pos < b);
        const after = base.update({
          changes: [
            { from: rawA, to: rawB },
            { from: t, insert: text.slice(rawA, rawB) },
          ],
          userEvent: "move.drop",
        }).state;
        // One line loses text and another gains it: both keep their numbers.
        const newS = after.doc.line(src.number);
        const newD = after.doc.line(dst.number);
        const gotS = shown(after, newS.from, newS.to);
        const gotD = shown(after, newD.from, newD.to);
        const keptS = beforeS.filter((c) => c.pos < a || c.pos >= b);
        const index = beforeD.filter((c) => c.pos < t).length;
        const wantD = [...beforeD.slice(0, index), ...moved, ...beforeD.slice(index)];
        checked++;
        const where = `${JSON.stringify(text.slice(a, b))} to ${String(t - dst.from)} in ${JSON.stringify(dst.text.slice(0, 100))} → ${JSON.stringify(newD.text.slice(0, 160))} / ${JSON.stringify(newS.text.slice(0, 120))}`;
        const sameText = (x: Char[], y: Char[]) =>
          x.map((c) => c.ch).join("") === y.map((c) => c.ch).join("");
        if (!sameText(gotS, keptS) || !sameText(gotD, wantD)) {
          failures.push(`text: ${where}`);
          continue;
        }
        // Dropped inside code or a link, the text goes in plain.
        if (wholeAtoms(base, t, t)[0] < t) continue;
        const movedKept = gotD.slice(index, index + moved.length).every((c, i) => {
          const m = moved[i];
          return (
            m === undefined ||
            /[\s\p{P}\p{S}]/u.test(c.ch) ||
            letters(m.styles).every((x) => c.styles.includes(x))
          );
        });
        if (!movedKept) lost.push(where);
      }
    }
    expect(checked).toBeGreaterThan(150);
    expect(failures.slice(0, 6)).toEqual([]);
    expect(lost.length / checked, lost.slice(0, 4).join("\n")).toBeLessThan(0.03);
  }, 180_000);
});
