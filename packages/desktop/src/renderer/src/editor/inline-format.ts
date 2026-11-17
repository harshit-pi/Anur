import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import {
  type ChangeSpec,
  EditorSelection,
  EditorState,
  type SelectionRange,
} from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { markdownSupport } from "./sections.ts";

/**
 * Bold, italic and strikethrough as the person sees them, not as characters
 * (fixes ⌘B on bold text whose hidden marks the selection half-covered).
 *
 * The stretch of a line a command touches is read from the editor's own
 * parse into characters that each know whether they are bold, italic or
 * struck through; links, code and other elements are kept whole. The command
 * flips one style on the chosen characters, as Google Docs does: if all of
 * them have it, they lose it; otherwise they all gain it. The stretch is
 * then written back with marks placed correctly, so unbolding one word in a
 * bold sentence leaves the words around it bold. Text outside the stretch is
 * never touched.
 */

export type Style = "bold" | "italic" | "strike";

const STYLE_OF: Record<string, Style> = {
  StrongEmphasis: "bold",
  Emphasis: "italic",
  Strikethrough: "strike",
};
const MARK: Record<Style, string> = { strike: "~~", bold: "**", italic: "*" };
/** Outermost first, so marks always nest the same way. */
const ORDER: Style[] = ["strike", "bold", "italic"];
/** Kept whole: a selection edge inside one moves to its edge. */
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

/** A piece of the stretch: one character, or a whole element kept as written. */
type Piece = { text: string; atom: boolean; styles: Set<Style>; selected: boolean };

const styleNodes = (node: SyntaxNode) => STYLE_OF[node.name] !== undefined;

/** The inline nodes under `from..to` in a line, styles and atoms only. */
function nodesIn(state: EditorState, from: number, to: number): SyntaxNode[] {
  const tree = ensureSyntaxTree(state, to, 200) ?? syntaxTree(state);
  const found: SyntaxNode[] = [];
  tree.iterate({
    from,
    to,
    enter(ref) {
      if (styleNodes(ref.node) || ATOMS.has(ref.name)) {
        if (ref.to > from && ref.from < to) found.push(ref.node);
        if (ATOMS.has(ref.name)) return false;
      }
      return undefined;
    },
  });
  return found;
}

/**
 * The stretch to rewrite: the selection, moved off any atom it cuts into and
 * grown to cover every style element it overlaps, within one line.
 */
function stretchFor(
  state: EditorState,
  from: number,
  to: number,
  lineFrom: number,
  lineTo: number,
) {
  let a = Math.max(from, lineFrom);
  let b = Math.min(to, lineTo);
  let selFrom = a;
  let selTo = b;
  for (let grew = true; grew;) {
    grew = false;
    for (const n of nodesIn(state, a, b === a ? b + 0 : b)) {
      const overlaps = n.to > a && n.from < b;
      const touches = overlaps || (a === b && n.from <= a && n.to >= a);
      if (!touches) continue;
      if (ATOMS.has(n.name)) {
        // An edge inside an atom moves to the atom's edge.
        if (selFrom > n.from && selFrom < n.to) selFrom = n.from;
        if (selTo > n.from && selTo < n.to) selTo = n.to;
      }
      if (n.from < a) {
        a = Math.max(lineFrom, n.from);
        grew = true;
      }
      if (n.to > b) {
        b = Math.min(lineTo, n.to);
        grew = true;
      }
    }
  }
  return { from: a, to: b, selFrom, selTo };
}

/** Read `from..to` into pieces: characters with their styles, atoms kept whole, marks dropped. */
function readPieces(state: EditorState, from: number, to: number, selFrom: number, selTo: number) {
  const marks: [number, number][] = [];
  const atoms: SyntaxNode[] = [];
  const styled: { from: number; to: number; style: Style }[] = [];
  for (const n of nodesIn(state, from, to)) {
    if (ATOMS.has(n.name)) {
      atoms.push(n);
      continue;
    }
    const style = STYLE_OF[n.name];
    if (!style) continue;
    styled.push({ from: n.from, to: n.to, style });
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.name === "EmphasisMark" || c.name === "StrikethroughMark") marks.push([c.from, c.to]);
    }
  }
  const stylesAt = (pos: number) =>
    new Set(styled.filter((s) => s.from <= pos && pos < s.to).map((s) => s.style));
  const pieces: Piece[] = [];
  for (let pos = from; pos < to;) {
    const mark = marks.find(([m, e]) => m <= pos && pos < e);
    if (mark) {
      pos = mark[1];
      continue;
    }
    const atom = atoms.find((n) => n.from === pos);
    const end = atom ? atom.to : pos + 1;
    pieces.push({
      text: state.sliceDoc(pos, end),
      atom: Boolean(atom),
      styles: stylesAt(pos),
      selected: pos >= selFrom && end <= selTo,
    });
    pos = end;
  }
  return pieces;
}

const isSpace = (p: Piece) => !p.atom && /\s/.test(p.text);

/**
 * Write pieces back with marks. Marks already open stay open, and new ones
 * open inside them, so nothing closes just to reopen. A mark never touches
 * a space on its inner side: closing marks go before the spaces, opening
 * marks after, which is what Markdown needs to read them as marks.
 */
export function writePieces(pieces: Piece[]): string {
  let out = "";
  const open: Style[] = [];
  let spaces = "";
  for (const p of pieces) {
    if (isSpace(p)) {
      spaces += p.text;
      continue;
    }
    const want = p.styles;
    // Close from the top until everything left open is still wanted.
    let keep = open.length;
    for (let k = 0; k < open.length; k++) {
      if (!want.has(open[k] as Style)) {
        keep = k;
        break;
      }
    }
    while (open.length > keep) out += MARK[open.pop() as Style];
    out += spaces;
    spaces = "";
    for (const s of ORDER) {
      if (want.has(s) && !open.includes(s)) {
        out += MARK[s];
        open.push(s);
      }
    }
    out += p.text;
  }
  while (open.length) out += MARK[open.pop() as Style];
  return out + spaces;
}

/** What `from..to` of a doc shows, read in place: each character, marks left out, with its styles. */
function styledChars(text: string, from: number, to: number): { ch: string; styles: string }[] {
  const state = EditorState.create({ doc: text, extensions: [markdownSupport()] });
  const tree = ensureSyntaxTree(state, to, 2000) ?? syntaxTree(state);
  const marks: [number, number][] = [];
  const styled: { from: number; to: number; style: Style }[] = [];
  tree.iterate({
    from,
    to,
    enter(n) {
      if (n.name === "EmphasisMark" || n.name === "StrikethroughMark") marks.push([n.from, n.to]);
      const style = STYLE_OF[n.name];
      if (style) styled.push({ from: n.from, to: n.to, style });
    },
  });
  const out: { ch: string; styles: string }[] = [];
  for (let pos = from; pos < to; pos++) {
    if (marks.some(([a, b]) => a <= pos && pos < b)) continue;
    const styles = ORDER.filter((st) =>
      styled.some((x) => x.style === st && x.from <= pos && pos < x.to),
    );
    out.push({ ch: text.charAt(pos), styles: styles.join(",") });
  }
  return out;
}

/**
 * A selection grown to whole space-separated tokens at both ends, so its
 * marks sit beside spaces, where Markdown always reads them.
 */
function toTokens(state: EditorState, range: SelectionRange): SelectionRange {
  const word = /\S/u;
  let from = range.from;
  let to = range.to;
  const startLine = state.doc.lineAt(from);
  const endLine = state.doc.lineAt(to);
  while (from > startLine.from && word.test(state.sliceDoc(from - 1, from))) from--;
  while (to < endLine.to && word.test(state.sliceDoc(to, to + 1))) to++;
  return EditorSelection.range(from, to);
}

/** The changes that flip `style` on one selection range; none when it changes nothing. */
function flipRange(
  state: EditorState,
  range: SelectionRange,
  style: Style,
  widened = false,
): ChangeSpec[] {
  const changes: ChangeSpec[] = [];
  const first = state.doc.lineAt(range.from).number;
  const last = state.doc.lineAt(range.to).number;
  for (let n = first; n <= last; n++) {
    const line = state.doc.line(n);
    const s = stretchFor(state, range.from, range.to, line.from, line.to);
    if (s.selTo <= s.selFrom) continue;
    const pieces = readPieces(state, s.from, s.to, s.selFrom, s.selTo);
    const chosen = pieces.filter((p) => p.selected && !isSpace(p));
    if (chosen.length === 0) continue;
    const remove = chosen.every((p) => p.styles.has(style));
    for (const p of chosen) {
      p.styles = new Set(p.styles);
      if (remove) p.styles.delete(style);
      else p.styles.add(style);
    }
    const text = writePieces(pieces);
    const old = state.sliceDoc(s.from, s.to);
    if (text === old) continue;
    // Never write marks Markdown would read otherwise. Read back in place
    // (so a line in a code block, where marks are just text, never passes),
    // the line must show the same characters, each with the style intended.
    // Beside punctuation a mark can fail to count: then grow the selection
    // to whole tokens once, and failing that, leave the line alone.
    const whole = state.doc.toString();
    const next = whole.slice(0, s.from) + text + whole.slice(s.to);
    const grown = text.length - old.length;
    const intended = [
      ...styledChars(whole, line.from, s.from),
      // By UTF-16 unit, as positions count, so an emoji is two, as read back.
      ...pieces.flatMap((p) => {
        const styles = ORDER.filter((st) => p.styles.has(st)).join(",");
        return Array.from({ length: p.text.length }, (_, k) => ({ ch: p.text.charAt(k), styles }));
      }),
      ...styledChars(whole, s.to, line.to),
    ];
    const actual = styledChars(next, line.from, line.to + grown);
    const same =
      actual.length === intended.length &&
      actual.every((c, k) => {
        const want = intended[k];
        return (
          want !== undefined && c.ch === want.ch && (/\s/.test(c.ch) || c.styles === want.styles)
        );
      });
    if (same) {
      changes.push(...minimalEdits(old, text, s.from));
    } else if (!widened) {
      const wide = toTokens(state, range);
      if (wide.from !== range.from || wide.to !== range.to) {
        changes.push(...flipRange(state, wide, style, true));
      }
    }
  }
  return changes;
}

/** Changes that flip `style` on every selection range; empty when nothing changes. */
export function flipStyle(
  state: EditorState,
  style: Style,
  ranges: readonly SelectionRange[] = state.selection.ranges,
): ChangeSpec[] {
  return ranges.flatMap((r) => (r.empty ? [] : flipRange(state, r, style)));
}

/**
 * The few edits that turn `a` into `b`, mostly marks added or removed, as
 * offsets from `at`: the selection maps through them onto the same words.
 */
export function minimalEdits(a: string, b: string, at: number): ChangeSpec[] {
  if (a.length * b.length > 4_000_000) return [{ from: at, to: at + a.length, insert: b }];
  // Longest common subsequence, then the gaps between kept characters.
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    const row = lcs[i] as Uint16Array;
    const next = lcs[i + 1] as Uint16Array;
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const edits: ChangeSpec[] = [];
  let i = 0;
  let j = 0;
  let from = -1;
  let insert = "";
  const flush = (to: number) => {
    if (from >= 0) edits.push({ from: at + from, to: at + to, insert });
    from = -1;
    insert = "";
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      flush(i);
      i++;
      j++;
    } else if (j < m && (i >= n || (lcs[i]?.[j + 1] ?? 0) >= (lcs[i + 1]?.[j] ?? 0))) {
      if (from < 0) from = i;
      insert += b[j] ?? "";
      j++;
    } else {
      if (from < 0) from = i;
      i++;
    }
  }
  flush(i);
  return edits;
}

/** The style a mark stands for. */
export const styleOfMark = (mark: string): Style | null =>
  mark === "**" ? "bold" : mark === "*" ? "italic" : mark === "~~" ? "strike" : null;
