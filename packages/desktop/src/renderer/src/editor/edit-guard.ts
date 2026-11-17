import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import {
  ChangeSet,
  type ChangeSpec,
  EditorSelection,
  EditorState,
  Text,
  Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { copyText, insertMarkdown, minimalEdits } from "./inline-format.ts";
import { markdownSupport } from "./sections.ts";

/**
 * Edits on a page whose Markdown marks are hidden (live preview). The person
 * edits what they see, so the marks they can't see must come out right:
 *
 * - Deleting removes only visible text. A format's hidden marks stay unless
 *   all of its visible text goes, and then they go too, so no stray ** or
 *   empty **** is left behind. Backspace or Delete beside hidden marks steps
 *   over them to the visible character.
 * - A space typed at the inner edge of a format goes outside its marks,
 *   where it keeps the format valid; Enter inside a format closes it before
 *   the line break and opens it again after.
 * - Copying gives balanced Markdown: a part of bold text copies as bold.
 */

type Span = [number, number];

const FORMATS = new Set([
  "StrongEmphasis",
  "Emphasis",
  "Strikethrough",
  "InlineCode",
  "Link",
  "WikiLink",
]);
const STYLED = new Set(["StrongEmphasis", "Emphasis", "Strikethrough"]);

/** The parts of a format the page doesn't show: its marks, a link's address. */
export function hiddenParts(node: SyntaxNode): Span[] {
  const kids: SyntaxNode[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) kids.push(c);
  const marks = (name: string) =>
    kids.filter((k) => k.name === name).map((k): Span => [k.from, k.to]);
  switch (node.name) {
    case "StrongEmphasis":
    case "Emphasis":
      return marks("EmphasisMark");
    case "Strikethrough":
      return marks("StrikethroughMark");
    case "InlineCode":
      return marks("CodeMark");
    case "Link": {
      const lm = kids.filter((k) => k.name === "LinkMark");
      const open = lm[0];
      const close = lm[1];
      if (!open || !close || lm.length < 3) return [];
      return [
        [open.from, open.to],
        [close.from, node.to],
      ];
    }
    case "WikiLink": {
      const alias = kids.find((k) => k.name === "WikiLinkAlias");
      if (alias) {
        return [
          [node.from, alias.from],
          [alias.to, node.to],
        ];
      }
      const shown = kids.filter((k) => k.name === "WikiLinkTarget" || k.name === "WikiLinkHeading");
      const first = shown[0];
      const last = shown.at(-1);
      if (!first || !last) return [[node.from, node.to]];
      const parts: Span[] = [[node.from, first.from]];
      if (shown.length > 1 && shown[1]) parts.push([first.to, shown[1].from]);
      parts.push([last.to, node.to]);
      return parts;
    }
    default:
      return [];
  }
}

function formatsOver(state: EditorState, from: number, to: number): SyntaxNode[] {
  const tree = ensureSyntaxTree(state, to + 1, 200) ?? syntaxTree(state);
  const found: SyntaxNode[] = [];
  tree.iterate({
    from: Math.max(0, from - 1),
    to: Math.min(state.doc.length, to + 1),
    enter(ref) {
      if (FORMATS.has(ref.name) && ref.to > from - 1 && ref.from < to + 1) found.push(ref.node);
    },
  });
  // Outer formats first, so an inner one fully deleted goes with its marks.
  return found.sort((a, b) => a.from - b.from || b.to - a.to);
}

const union = (spans: Span[]): Span[] => {
  const sorted = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Span[] = [];
  for (const [a, b] of sorted) {
    const last = out.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
};

const subtract = (spans: Span[], cut: Span[]): Span[] =>
  spans.flatMap(([a, b]) => {
    let pieces: Span[] = [[a, b]];
    for (const [c, d] of cut) {
      pieces = pieces.flatMap(([x, y]): Span[] => {
        if (d <= x || c >= y) return [[x, y]];
        return [
          [x, Math.max(x, c)],
          [Math.min(y, d), y],
        ].filter(([p, q]) => (q as number) > (p as number)) as Span[];
      });
    }
    return pieces;
  });

const covers = (spans: Span[], [a, b]: Span) => spans.some(([x, y]) => x <= a && b <= y);

/** What deleting `from..to` should remove, so that only visible text goes. */
export function deletionSpans(state: EditorState, from: number, to: number): Span[] {
  let spans: Span[] = [[from, to]];
  const nodes = formatsOver(state, from, to);
  for (let pass = 0; pass < 2; pass++) {
    for (const node of nodes) {
      const hidden = hiddenParts(node);
      const visible = subtract([[node.from, node.to]], hidden);
      if (visible.length === 0) continue;
      const overlaps = spans.some(([a, b]) => b > node.from && a < node.to);
      if (!overlaps) continue;
      spans = visible.every((v) => covers(spans, v))
        ? union([...spans, [node.from, node.to]])
        : union(subtract(spans, hidden));
    }
  }
  return spans;
}

const inSpans = (spans: Span[], pos: number) => spans.some(([a, b]) => a <= pos && pos < b);

/**
 * After deleting `spans`, a format that survives may start or end with a
 * space, which Markdown won't read as a format: move its mark past the
 * spaces instead, so the spaces stay visible and the format stays valid.
 */
function edgeFixes(state: EditorState, spans: Span[]): ChangeSpec[] {
  if (spans.length === 0) return [];
  const from = Math.min(...spans.map(([a]) => a));
  const to = Math.max(...spans.map(([, b]) => b));
  const fixes: ChangeSpec[] = [];
  for (const node of formatsOver(state, from, to)) {
    if (!STYLED.has(node.name)) continue;
    const parts = hiddenParts(node);
    const open = parts[0];
    const close = parts.at(-1);
    if (!open || !close || inSpans(spans, open[0]) || inSpans(spans, close[0])) continue;
    const kept = (p: number) => !inSpans(spans, p);
    // First and last characters that stay inside the format.
    let first = open[1];
    while (first < close[0] && (!kept(first) || /\s/.test(state.sliceDoc(first, first + 1)))) {
      first++;
    }
    let last = close[0];
    while (last > first && (!kept(last - 1) || /\s/.test(state.sliceDoc(last - 1, last)))) {
      last--;
    }
    const opener = state.sliceDoc(open[0], open[1]);
    const closer = state.sliceDoc(close[0], close[1]);
    if (first >= last) {
      // Only spaces are left: the format goes, its spaces stay.
      fixes.push({ from: open[0], to: open[1] }, { from: close[0], to: close[1] });
      continue;
    }
    const leadingSpace = (p: number) => kept(p) && /\s/.test(state.sliceDoc(p, p + 1));
    let p = open[1];
    let spaced = false;
    for (; p < first; p++) if (leadingSpace(p)) spaced = true;
    if (spaced) fixes.push({ from: open[0], to: open[1] }, { from: first, insert: opener });
    let q = last;
    spaced = false;
    for (; q < close[0]; q++) if (leadingSpace(q)) spaced = true;
    if (spaced) fixes.push({ from: last, insert: closer }, { from: close[0], to: close[1] });
  }
  return fixes;
}

/** The visible character just before `pos`, stepping back over hidden marks. */
function visibleBefore(state: EditorState, pos: number): number | null {
  const line = state.doc.lineAt(pos);
  let p = pos;
  for (let guard = 0; guard < 8; guard++) {
    const part = formatsOver(state, p - 1, p)
      .flatMap(hiddenParts)
      .find(([, b]) => b === p);
    if (!part) break;
    p = part[0];
  }
  return p > line.from ? p - 1 : null;
}

/** The visible character at or after `pos`, stepping over hidden marks. */
function visibleAfter(state: EditorState, pos: number): number | null {
  const line = state.doc.lineAt(pos);
  let p = pos;
  for (let guard = 0; guard < 8; guard++) {
    const part = formatsOver(state, p, p + 1)
      .flatMap(hiddenParts)
      .find(([a]) => a === p);
    if (!part) break;
    p = part[1];
  }
  return p < line.to ? p : null;
}

/** The styled formats `pos` sits inside, outermost first. */
function stylesAround(state: EditorState, pos: number): SyntaxNode[] {
  return formatsOver(state, pos, pos).filter((n) => {
    if (!STYLED.has(n.name)) return false;
    const [open, close] = [hiddenParts(n)[0], hiddenParts(n).at(-1)];
    return open !== undefined && close !== undefined && open[1] <= pos && pos <= close[0];
  });
}

const GUARDED = ["delete", "input.type", "input.paste", "input.drop", "input", "move.drop"];
const SKIPPED = [
  "input.format",
  "input.complete",
  "input.table",
  "input.chip",
  "input.link",
  "input.check",
  "input.properties",
  "input.restore",
];

/** Rewrite one transaction's edit so the hidden marks stay valid; null when it already keeps them. */
export function guardChanges(tr: Transaction): TransactionSpec | null {
  if (!tr.docChanged || tr.startState.selection.ranges.length > 1) return null;
  if (SKIPPED.some((e) => tr.isUserEvent(e))) return null;
  if (!GUARDED.some((e) => tr.isUserEvent(e))) return null;
  const state = tr.startState;
  const edits: { from: number; to: number; text: string }[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    edits.push({ from: fromA, to: toA, text: inserted.toString() });
  });
  if (tr.isUserEvent("move.drop")) return guardMove(tr, edits);
  const edit = edits[0];
  if (edits.length !== 1 || !edit) return null;
  const line = state.doc.lineAt(edit.from);
  if (edit.to > line.to) return null; // Across lines: left as it is.
  const userEvent = tr.annotation(Transaction.userEvent) ?? "input";
  const finish = (
    changes: ChangeSpec[],
    caretAt: number,
    insertLength: number,
  ): TransactionSpec => {
    const set = ChangeSet.of(changes, state.doc.length);
    const anchor = set.mapPos(caretAt, -1) + insertLength;
    return {
      changes: set,
      selection: EditorSelection.cursor(anchor),
      userEvent,
      scrollIntoView: true,
    };
  };

  // What the line showed, and what it should show once the edit is done.
  const before = visibleChars(state.doc.toString(), line.from, line.to);
  const accepts = (
    changes: ChangeSpec[],
    removed: (pos: number) => boolean,
    typedAt: number | null,
    lenient = false,
  ) => {
    const set = ChangeSet.of(changes, state.doc.length);
    const next = set.apply(state.doc).toString();
    const newLineTo = set.mapPos(line.to, 1);
    const newLineFrom = set.mapPos(line.from, -1);
    const got = visibleChars(next, newLineFrom, newLineTo);
    const kept = before.filter((c) => !removed(c.pos));
    const typed = edit.text;
    const index = typedAt === null ? -1 : kept.filter((c) => c.pos < typedAt).length;
    const wantText =
      index < 0
        ? kept.map((c) => c.ch).join("")
        : kept
            .slice(0, index)
            .map((c) => c.ch)
            .join("") +
          typed +
          kept
            .slice(index)
            .map((c) => c.ch)
            .join("");
    if (got.map((c) => c.ch).join("") !== wantText) return false;
    const others = index < 0 ? got : [...got.slice(0, index), ...got.slice(index + typed.length)];
    // Lenient: the text is what matters; a style lost where Markdown can't
    // keep it (a mark between "." and a word) is better than a stray mark.
    if (lenient) return true;
    return others.every((c, k) => /\s/.test(c.ch) || c.styles === kept[k]?.styles);
  };

  // Pasting or dropping one line of Markdown (guardPaste). A pasted line
  // break keeps the Markdown as written, closing formats around it as Enter does.
  if (
    (tr.isUserEvent("input.paste") || tr.isUserEvent("input.drop")) &&
    !edit.text.includes("\n")
  ) {
    return guardPaste(state, line, edit, userEvent);
  }

  // Typing with nothing selected.
  if (edit.to === edit.from) {
    const pos = edit.from;
    const nodes = formatsOver(state, pos, pos);
    const edges = nodes.flatMap(hiddenParts).filter(([a, b]) => a === pos || b === pos);
    if (edit.text.includes("\n")) {
      const text = breakFormats(state, pos, edit.text);
      return text === edit.text ? null : finish([{ from: pos, insert: text }], pos, text.length);
    }
    // Fast path: away from any hidden mark, typing is just typing.
    if (edges.length === 0) return null;
    // At a format's edge: the places the text could go, the likeliest first.
    // A space goes outside a format; anything else stays where it was typed.
    const places = new Set<number>();
    const outside = (p: number) => {
      for (const [a, b] of edges) {
        if (a === p) places.add(a);
        if (b === p) places.add(b);
      }
    };
    if (/^\s/.test(edit.text)) {
      for (const n of nodes) {
        const [open, close] = [hiddenParts(n)[0], hiddenParts(n).at(-1)];
        if (close && close[0] === pos) places.add(n.to);
        if (open && open[1] === pos) places.add(n.from);
      }
    }
    places.add(pos);
    outside(pos);
    for (const [a, b] of edges) places.add(a === pos ? b : a);
    for (const at of places) {
      if (accepts([{ from: at, insert: edit.text }], () => false, at)) {
        return at === pos ? null : finish([{ from: at, insert: edit.text }], at, edit.text.length);
      }
    }
    return null;
  }

  // Deleting (and perhaps typing over the selection).
  let spans: Span[] = deletionSpans(state, edit.from, edit.to);
  if (spans.length === 0 && edit.text === "") {
    // Only hidden marks were in the way. Backspace and Delete take the
    // visible character beside them; a selection of nothing visible does nothing.
    if (tr.isUserEvent("delete.backward") || tr.isUserEvent("delete.forward")) {
      const back = tr.isUserEvent("delete.backward");
      const p = back ? visibleBefore(state, edit.from) : visibleAfter(state, edit.to);
      if (p === null) return { changes: [], userEvent };
      spans = deletionSpans(state, p, p + 1);
    } else return { changes: [], userEvent };
  }
  const changes: ChangeSpec[] = [
    ...spans.map(([a, b]): ChangeSpec => ({ from: a, to: b })),
    ...edgeFixes(state, spans),
    ...joinFixes(state, spans),
  ];
  const at = spans[0]?.[0] ?? edit.from;
  // Enter often replaces the space after the cursor: its line break still
  // closes the formats it falls inside, and opens them again after.
  const typed = edit.text.includes("\n") ? breakFormats(state, at, edit.text) : edit.text;
  if (typed !== "") changes.push({ from: at, insert: typed });
  // A line break is shaped by breakFormats; the check reads one line at a time.
  if (typed.includes("\n")) return finish(changes, at, typed.length);
  const removed = (pos: number) => spans.some(([a, b]) => a <= pos && pos < b);
  const typedAt = typed === "" || typed.includes("\n") ? null : at;
  if (!accepts(changes, removed, typedAt)) {
    // Markdown can't say it exactly, as when the deletion leaves a word
    // touching the closing mark of bold text that ends in punctuation
    // ("done.**next"). Then the mark moves past that punctuation instead,
    // and failing that, the formats touched lose their marks: never a
    // stray ** on the page.
    const shifted = [...changes, ...punctuationFixes(state, spans)];
    if (accepts(shifted, removed, typedAt, true)) return finish(shifted, at, typed.length);
    const plain: ChangeSpec[] = [
      ...spans.map(([a, b]): ChangeSpec => ({ from: a, to: b })),
      ...dropFormats(state, spans),
      ...(typed === "" ? [] : [{ from: at, insert: typed }]),
    ];
    return finish(plain, at, typed.length);
  }
  const original = spans.length === 1 && spans[0]?.[0] === edit.from && spans[0][1] === edit.to;
  if (original && typed === edit.text && changes.length === (typed === "" ? 1 : 2)) return null;
  return finish(changes, at, typed.length);
}

/**
 * A paste is right when the line shows what it showed, less what was
 * replaced, with the pasted text in place: every old character keeping its
 * style, every pasted one keeping at least its own.
 */
function pasteReadsBack(
  state: EditorState,
  line: { from: number; to: number },
  changes: ChangeSpec[],
  gone: (pos: number) => boolean,
  at: number,
  pasted: { text: string; atom: boolean; styles: Set<string> }[],
  checkOwnStyles = true,
): boolean {
  const before = visibleChars(state.doc.toString(), line.from, line.to).filter((c) => !gone(c.pos));
  const set = ChangeSet.of(changes, state.doc.length);
  const next = set.apply(state.doc).toString();
  const got = visibleChars(next, set.mapPos(line.from, -1), set.mapPos(line.to, 1));
  const index = before.filter((c) => c.pos < at).length;
  // A pasted link or code shows its text, not its marks.
  const pastedChars = pasted.flatMap((p) =>
    (p.atom ? plainOf(p.text) : p.text).split("").map((ch) => ({ ch, styles: p.styles })),
  );
  const want = [
    ...before.slice(0, index).map((c) => c.ch),
    ...pastedChars.map((c) => c.ch),
    ...before.slice(index).map((c) => c.ch),
  ];
  if (got.map((c) => c.ch).join("") !== want.join("")) return false;
  const NAME: Record<string, string> = {
    bold: "StrongEmphasis",
    italic: "Emphasis",
    strike: "Strikethrough",
  };
  return got.every((c, k) => {
    // Punctuation may step out of a format, where a mark beside it can't be read.
    if (/[\s\p{P}\p{S}]/u.test(c.ch)) return true;
    if (k < index) return c.styles === before[k]?.styles;
    if (k < index + pastedChars.length) {
      if (!checkOwnStyles) return true;
      const own = pastedChars[k - index]?.styles ?? new Set<string>();
      return [...own].every((st) => c.styles.split(",").includes(NAME[st] ?? st));
    }
    return c.styles === before[k - pastedChars.length]?.styles;
  });
}

/** Atoms (code, links, wiki links) a range cuts into: grown to take each whole. */
function wholeAtoms(state: EditorState, from: number, to: number): Span {
  let a = from;
  let b = to;
  for (const n of formatsOver(state, from, to)) {
    if (STYLED.has(n.name)) continue;
    if (n.from < a && n.to > a) a = n.from;
    if (n.from < b && n.to > b) b = n.to;
  }
  return [a, b];
}

/** Inside an atom (code, a link): past its opening part, before its closing one. */
function insideAtom(state: EditorState, at: number): boolean {
  return formatsOver(state, at, at).some((n) => {
    if (STYLED.has(n.name) || !(n.from < at && at < n.to)) return false;
    const parts = hiddenParts(n);
    // Brackets with no address show as text: inside them is inside text.
    if (parts.length === 0) return true;
    const first = parts[0];
    const last = parts.at(-1);
    return first !== undefined && last !== undefined && first[1] <= at && at <= last[0];
  });
}

/** Markdown's visible text alone, marks and link targets left out, as a plain-text paste would be. */
function plainOf(markdown: string): string {
  return visibleChars(markdown, 0, markdown.length)
    .map((c) => c.ch)
    .join("");
}

/** A position and the others across the hidden marks beside it: the page shows them as one place. */
function placesAt(state: EditorState, at: number): number[] {
  const parts = formatsOver(state, at, at)
    .filter((n) => STYLED.has(n.name))
    .flatMap(hiddenParts);
  const places = [at];
  for (let k = 0; k < places.length; k++) {
    const p = places[k] as number;
    for (const [a, b] of parts) {
      if (a === p && !places.includes(b)) places.push(b);
      if (b === p && !places.includes(a)) places.push(a);
    }
  }
  return places;
}

type Placed = { changes: ChangeSpec[]; from: number; caret: number };

/**
 * One line of Markdown put in at `at`, with `from..to` going: the stretch it
 * lands in is rebuilt with it in place, so its marks and the ones around it
 * come out right, then read back to check. It tries each side of the marks
 * at `at`, first with its own styles, then with only the surrounding ones.
 */
function placeMarkdown(
  state: EditorState,
  line: { from: number; to: number },
  markdown: string,
  at: number,
  removing: { from: number; to: number; spans: Span[] },
): Placed | null {
  const { from, to, spans } = removing;
  const gone = (p: number) => spans.some(([a, b]) => a <= p && p < b);
  for (const own of [true, false]) {
    for (const place of placesAt(state, at)) {
      const built = insertMarkdown(state, place, markdown, gone, from, to, own);
      if (!built) continue;
      const outside = spans
        .filter(([a, b]) => b <= built.from || a >= built.to)
        .map(([a, b]): ChangeSpec => ({ from: a, to: b }));
      const changes = [
        ...outside,
        ...minimalEdits(state.sliceDoc(built.from, built.to), built.text, built.from),
      ];
      if (pasteReadsBack(state, line, changes, gone, at, built.pasted, own)) {
        return { changes, from: built.from, caret: built.caret };
      }
    }
  }
  return null;
}

/** Inside code or a link: plain text there must leave it whole, as brackets or backticks might not. */
function plainFits(
  state: EditorState,
  line: { from: number; to: number },
  at: number,
  plain: string,
): boolean {
  const doc = state.doc.toString();
  const next = state.doc.replace(at, at, Text.of([plain])).toString();
  const read = (text: string, from: number, to: number) =>
    visibleChars(text, from, to)
      .map((c) => c.ch)
      .join("");
  const before = read(doc, line.from, line.to);
  const k = read(doc, line.from, at).length;
  return (
    read(next, line.from, line.to + plain.length) === before.slice(0, k) + plain + before.slice(k)
  );
}

/**
 * placeMarkdown, then its plain text where Markdown can't say it; inside
 * code or a link, where plain text won't fit, just after it.
 */
function placeAround(
  state: EditorState,
  line: { from: number; to: number },
  markdown: string,
  at: number,
  removing: { from: number; to: number; spans: Span[] },
): Placed | null {
  const atom = formatsOver(state, at, at).find(
    (n) => !STYLED.has(n.name) && n.from < at && at < n.to,
  );
  const after = atom !== undefined && removing.spans.length === 0;
  const place = after ? atom.to : at;
  const where = after ? { from: place, to: place, spans: [] } : removing;
  return (
    placeMarkdown(state, line, markdown, place, where) ??
    placeMarkdown(state, line, plainOf(markdown), place, where)
  );
}

const caretAfter = (state: EditorState, placed: Placed) => {
  const set = ChangeSet.of(placed.changes, state.doc.length);
  return { set, caret: set.mapPos(placed.from, -1) + placed.caret };
};

/**
 * Pasting or dropping one line of Markdown (placeMarkdown). Where Markdown
 * can't say it, the plain text goes in. Inside code or a link, formatting
 * can't live, so the plain text goes in.
 */
function guardPaste(
  state: EditorState,
  line: { from: number; to: number },
  edit: { from: number; to: number; text: string },
  userEvent: string,
): TransactionSpec | null {
  const [from, to] =
    edit.to > edit.from ? wholeAtoms(state, edit.from, edit.to) : [edit.from, edit.to];
  const spans = to > from ? deletionSpans(state, from, to) : [];
  const at = spans[0]?.[0] ?? from;
  const plain = plainOf(edit.text);
  if (to === from && insideAtom(state, at) && plainFits(state, line, at, plain)) {
    return plain === edit.text
      ? null
      : {
          changes: { from: at, insert: plain },
          selection: EditorSelection.cursor(at + plain.length),
          userEvent,
          scrollIntoView: true,
        };
  }
  const placed = placeAround(state, line, edit.text, at, { from, to, spans });
  if (placed) {
    const { set, caret } = caretAfter(state, placed);
    return {
      changes: set,
      selection: EditorSelection.cursor(caret),
      userEvent,
      scrollIntoView: true,
    };
  }
  // The plain text, with only what was selected gone.
  const changes: ChangeSpec[] = [
    ...spans.map(([a, b]): ChangeSpec => ({ from: a, to: b })),
    ...edgeFixes(state, spans),
    ...joinFixes(state, spans),
    { from: at, insert: plain },
  ];
  const set = ChangeSet.of(changes, state.doc.length);
  return {
    changes: set,
    selection: EditorSelection.cursor(set.mapPos(at, -1) + plain.length),
    userEvent,
    scrollIntoView: true,
  };
}

/**
 * A drag within the page: CodeMirror moves the raw characters, which can be
 * half a pair of marks. Instead the source goes as a deletion does, and a
 * balanced copy of it, carrying its styles, is put where it was dropped, as
 * a paste is.
 */
function guardMove(
  tr: Transaction,
  edits: { from: number; to: number; text: string }[],
): TransactionSpec | null {
  const state = tr.startState;
  const source = edits.find((e) => e.to > e.from && e.text === "");
  const target = edits.find((e) => e.to === e.from && e.text !== "");
  if (edits.length !== 2 || !source || !target) return null;
  const sourceLine = state.doc.lineAt(source.from);
  const targetLine = state.doc.lineAt(target.from);
  if (source.to > sourceLine.to) return null; // Several lines: left as it is.
  // A source cutting into code or a link takes it whole, as copying does.
  const [sFrom, sTo] = wholeAtoms(state, source.from, source.to);
  if (target.from > sFrom && target.from < sTo) return null;
  const moved = copyText(state, sFrom, sTo) ?? target.text;
  const spans = deletionSpans(state, sFrom, sTo);
  const gone = (p: number) => spans.some(([a, b]) => a <= p && p < b);
  const userEvent = tr.annotation(Transaction.userEvent) ?? "move.drop";
  const done = (changes: ChangeSpec[], caret: (set: ChangeSet) => number): TransactionSpec => {
    const set = ChangeSet.of(changes, state.doc.length);
    return {
      changes: set,
      selection: EditorSelection.cursor(caret(set)),
      userEvent,
      scrollIntoView: true,
    };
  };
  // The source goes as a deletion: its stretch rewritten without it.
  const built = insertMarkdown(state, sFrom, "", gone, sFrom, sTo);
  const taken = built
    ? minimalEdits(state.sliceDoc(built.from, built.to), built.text, built.from)
    : spans.map(([a, b]) => ({ from: a, to: b, insert: "" }));
  const plainAt = (changes: ChangeSpec[]) => {
    const plain = plainOf(moved);
    return done(
      [...changes, { from: target.from, insert: plain }],
      (set) => set.mapPos(target.from, -1) + plain.length,
    );
  };
  if (insideAtom(state, target.from) && plainFits(state, targetLine, target.from, plainOf(moved))) {
    // Into code or a link: the plain text, as a paste there goes in.
    if (taken.some((c) => c.from < target.from && target.from < c.to)) return null;
    return plainAt(taken);
  }
  if (sourceLine.number === targetLine.number) {
    const placed = placeAround(state, sourceLine, moved, target.from, {
      from: sFrom,
      to: sTo,
      spans,
    });
    if (placed) return done(placed.changes, (set) => set.mapPos(placed.from, -1) + placed.caret);
    return plainAt([
      ...spans.map(([a, b]): ChangeSpec => ({ from: a, to: b })),
      ...edgeFixes(state, spans),
      ...joinFixes(state, spans),
    ]);
  }
  const placed = placeAround(state, targetLine, moved, target.from, {
    from: target.from,
    to: target.from,
    spans: [],
  });
  if (!placed) return plainAt(taken);
  return done([...taken, ...placed.changes], (set) => set.mapPos(placed.from, -1) + placed.caret);
}

/**
 * Text with a line break typed inside formats: each format closes before
 * the break and opens again after everything typed with it, such as a
 * list's "- ", so both lines keep the format.
 */
function breakFormats(state: EditorState, at: number, text: string): string {
  const inside = stylesAround(state, at);
  if (inside.length === 0) return text;
  const closers = [...inside]
    .reverse()
    .map((n) => state.sliceDoc(...(hiddenParts(n).at(-1) as Span)));
  const openers = inside.map((n) => state.sliceDoc(...(hiddenParts(n)[0] as Span)));
  const nl = text.indexOf("\n");
  return text.slice(0, nl) + closers.join("") + text.slice(nl) + openers.join("");
}

const WORDCH = /[\p{L}\p{N}]/u;

/**
 * Marks a deletion leaves between punctuation and a word, moved inward past
 * that punctuation, and past any code, link or space beside it, until they
 * sit next to an ordinary character, where Markdown reads them.
 */
function punctuationFixes(state: EditorState, spans: Span[]): ChangeSpec[] {
  if (spans.length === 0) return [];
  const from = Math.min(...spans.map(([a]) => a));
  const to = Math.max(...spans.map(([, b]) => b));
  const gone = (p: number) => spans.some(([a, b]) => a <= p && p < b);
  const keptAfter = (p: number) => {
    let q = p;
    while (q < state.doc.length && gone(q)) q++;
    return state.sliceDoc(q, q + 1);
  };
  const keptBefore = (p: number) => {
    let q = p;
    while (q > 0 && gone(q - 1)) q--;
    return state.sliceDoc(q - 1, q);
  };
  const atoms = formatsOver(state, from - 200, to + 200).filter((n) => !STYLED.has(n.name));
  const fixes: ChangeSpec[] = [];
  for (const node of formatsOver(state, from, to)) {
    if (!STYLED.has(node.name)) continue;
    const open = hiddenParts(node)[0];
    const close = hiddenParts(node).at(-1);
    if (!open || !close || gone(open[0]) || gone(close[0])) continue;
    const ch = (p: number) => state.sliceDoc(p, p + 1);
    if (WORDCH.test(keptAfter(close[1])) && !WORDCH.test(ch(close[0] - 1))) {
      let q = close[0];
      for (let guard = 0; guard < 200 && q > open[1]; guard++) {
        const atom = atoms.find((a) => a.to === q && a.from >= open[1]);
        if (atom) q = atom.from;
        else if (!WORDCH.test(ch(q - 1))) q--;
        else break;
      }
      fixes.push({ from: close[0], to: close[1] });
      if (q > open[1]) fixes.push({ from: q, insert: state.sliceDoc(...close) });
      else fixes.push({ from: open[0], to: open[1] });
    }
    if (WORDCH.test(keptBefore(open[0])) && !WORDCH.test(ch(open[1]))) {
      let p = open[1];
      for (let guard = 0; guard < 200 && p < close[0]; guard++) {
        const atom = atoms.find((a) => a.from === p && a.to <= close[0]);
        if (atom) p = atom.to;
        else if (!WORDCH.test(ch(p))) p++;
        else break;
      }
      fixes.push({ from: open[0], to: open[1] });
      if (p < close[0]) fixes.push({ from: p, insert: state.sliceDoc(...open) });
      else fixes.push({ from: close[0], to: close[1] });
    }
  }
  return fixes;
}

/** The last resort: the formats a deletion touches lose their marks; their text stays. */
function dropFormats(state: EditorState, spans: Span[]): ChangeSpec[] {
  if (spans.length === 0) return [];
  const from = Math.min(...spans.map(([a]) => a));
  const to = Math.max(...spans.map(([, b]) => b));
  const gone = (p: number) => spans.some(([a, b]) => a <= p && p < b);
  return formatsOver(state, from, to)
    .filter((n) => STYLED.has(n.name))
    .flatMap((n) => hiddenParts(n))
    .filter(([a]) => !gone(a))
    .map(([a, b]): ChangeSpec => ({ from: a, to: b }));
}

/**
 * Two formats of one kind left touching by a deletion, such as ** and **
 * or ` and `, would read as one long mark: join them into one format.
 */
function joinFixes(state: EditorState, spans: Span[]): ChangeSpec[] {
  if (spans.length === 0) return [];
  const from = Math.min(...spans.map(([a]) => a));
  const to = Math.max(...spans.map(([, b]) => b));
  const nodes = formatsOver(state, from, to).filter(
    (n) => STYLED.has(n.name) || n.name === "InlineCode",
  );
  const fixes: ChangeSpec[] = [];
  const deleted = (a: number, b: number) => {
    for (let p = a; p < b; p++) if (!spans.some(([x, y]) => x <= p && p < y)) return false;
    return true;
  };
  for (const left of nodes) {
    for (const right of nodes) {
      if (left === right || left.name !== right.name || right.from < left.to) continue;
      const close = hiddenParts(left).at(-1);
      const open = hiddenParts(right)[0];
      if (!close || !open) continue;
      const closeKept = !spans.some(([a, b]) => a <= close[0] && close[0] < b);
      const openKept = !spans.some(([a, b]) => a <= open[0] && open[0] < b);
      if (closeKept && openKept && deleted(close[1], open[0])) {
        fixes.push({ from: close[0], to: close[1] }, { from: open[0], to: open[1] });
      }
    }
  }
  return fixes;
}

/** What a stretch shows, read in place: characters outside hidden parts, each with its styles. */
function visibleChars(
  text: string,
  from: number,
  to: number,
): { ch: string; pos: number; styles: string }[] {
  const state = EditorState.create({ doc: text, extensions: [markdownSupport()] });
  const tree = ensureSyntaxTree(state, to + 1, 2000) ?? syntaxTree(state);
  const hidden: Span[] = [];
  const styled: { from: number; to: number; s: string }[] = [];
  tree.iterate({
    from,
    to,
    enter(n) {
      if (FORMATS.has(n.name)) hidden.push(...hiddenParts(n.node));
      if (STYLED.has(n.name)) styled.push({ from: n.from, to: n.to, s: n.name });
    },
  });
  const out: { ch: string; pos: number; styles: string }[] = [];
  for (let pos = from; pos < to; pos++) {
    if (hidden.some(([a, b]) => a <= pos && pos < b)) continue;
    out.push({
      ch: text.charAt(pos),
      pos,
      styles: styled
        .filter((x) => x.from <= pos && pos < x.to)
        .map((x) => x.s)
        .sort()
        .join(","),
    });
  }
  return out;
}

/** The guard, as a filter: a guarded transaction replaces the one it rewrites. */
export const editGuard = [
  EditorState.transactionFilter.of((tr) => guardChanges(tr) ?? tr),
  EditorView.clipboardOutputFilter.of((text, state) => {
    const ranges = state.selection.ranges.filter((r) => !r.empty);
    if (ranges.length !== 1 || !ranges[0]) return text;
    return copyText(state, ranges[0].from, ranges[0].to) ?? text;
  }),
];
