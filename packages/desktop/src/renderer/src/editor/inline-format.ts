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
export type Piece = {
  text: string;
  atom: boolean;
  styles: Set<Style>;
  selected: boolean;
  /** Where it starts in the doc; -1 for text not yet in it, such as a paste. */
  pos: number;
};

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
      pos,
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
export function writePieces(pieces: Piece[], ends?: number[]): string {
  let out = "";
  const open: Style[] = [];
  let spaces = "";
  for (const p of pieces) {
    if (isSpace(p)) {
      spaces += p.text;
      // A space lands once the next word's marks are placed; until then,
      // count it where it will be written.
      ends?.push(out.length + spaces.length);
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
    ends?.push(out.length);
  }
  while (open.length) out += MARK[open.pop() as Style];
  return out + spaces;
}

const WORD = /[\p{L}\p{N}]/u;
const PUNCT = /^[\p{P}\p{S}]+$/u;

/**
 * A mark between punctuation inside a format and a word outside it
 * ("done.**next") doesn't read as a mark, so that punctuation steps out of
 * the format: "done**.next". Only the punctuation, or the code or link, loses
 * the style.
 */
export function shedPunctuation(pieces: Piece[]): Piece[] {
  const out = pieces.map((p) => ({ ...p, styles: new Set(p.styles) }));
  // Code or a link counts by its edge: a backtick or bracket is punctuation.
  const punct = (p: Piece, edge: string) => PUNCT.test(p.atom ? edge : p.text);
  for (let k = 0; k < out.length; k++) {
    const p = out[k] as Piece;
    const before = out[k - 1];
    if (!punct(p, p.text.charAt(0)) || !before || !WORD.test(before.text.slice(-1))) continue;
    for (const st of [...p.styles]) if (!before.styles.has(st)) p.styles.delete(st);
  }
  for (let k = out.length - 1; k >= 0; k--) {
    const p = out[k] as Piece;
    const after = out[k + 1];
    if (!punct(p, p.text.slice(-1)) || !after || !WORD.test(after.text.charAt(0))) continue;
    for (const st of [...p.styles]) if (!after.styles.has(st)) p.styles.delete(st);
  }
  return out;
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
export function minimalEdits(
  a: string,
  b: string,
  at: number,
): { from: number; to: number; insert: string }[] {
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
  const edits: { from: number; to: number; insert: string }[] = [];
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

/**
 * The selection as Markdown that stands on its own: a part of bold text
 * copies as bold, with both marks, never half a pair. Null when it can't be
 * read that way, such as across a code block, so the plain text is copied.
 */
export function copyText(state: EditorState, from: number, to: number): string | null {
  const lines: string[] = [];
  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(to).number;
  for (let n = first; n <= last; n++) {
    const line = state.doc.line(n);
    const a = Math.max(from, line.from);
    const b = Math.min(to, line.to);
    if (b <= a) {
      lines.push("");
      continue;
    }
    const s = stretchFor(state, a, b, line.from, line.to);
    // The selection as widened to keep links and code whole.
    const pieces = readPieces(state, s.from, s.to, s.selFrom, s.selTo).filter((p) => p.selected);
    lines.push(writePieces(pieces));
  }
  return lines.join(state.lineBreak);
}

/** The styles a position sits inside: the formats whose marks enclose it. */
export function stylesInside(state: EditorState, at: number): Set<Style> {
  const out = new Set<Style>();
  for (const n of nodesIn(state, Math.max(0, at - 1), Math.min(state.doc.length, at + 1))) {
    const style = STYLE_OF[n.name];
    if (!style) continue;
    const marks: [number, number][] = [];
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.name === "EmphasisMark" || c.name === "StrikethroughMark") marks.push([c.from, c.to]);
    }
    const open = marks[0];
    const close = marks.at(-1);
    if (open && close && open[1] <= at && at <= close[0]) out.add(style);
  }
  return out;
}

/** One line of Markdown read on its own into pieces, each with its own styles. */
export function piecesOf(markdown: string): Piece[] {
  const state = EditorState.create({ doc: markdown, extensions: [markdownSupport()] });
  ensureSyntaxTree(state, markdown.length, 2000);
  return readPieces(state, 0, markdown.length, -1, -1).map((p) => ({ ...p, pos: -1 }));
}

/**
 * A line's stretch rewritten with `markdown` (one line) inserted at `at` and
 * the characters `removed` says are deleted left out. Pasted text keeps its
 * own styles and takes those of the formats it lands inside, as typing there
 * would; every mark is written afresh, so nothing ends up doubled, nested
 * wrongly or half a pair. Null when a link or code would be cut into.
 */
export function insertMarkdown(
  state: EditorState,
  at: number,
  markdown: string,
  removed: (pos: number) => boolean,
  removeFrom = at,
  removeTo = at,
  ownStyles = true,
): { from: number; to: number; text: string; pasted: Piece[]; caret: number } | null {
  const line = state.doc.lineAt(at);
  // One character either side, so formats ending or starting right at the
  // paste are rebuilt with it.
  const s = stretchFor(
    state,
    Math.max(line.from, Math.min(at, removeFrom) - 1),
    Math.min(line.to, Math.max(at, removeTo) + 1),
    line.from,
    line.to,
  );
  const pieces = readPieces(state, s.from, s.to, -1, -1);
  for (const p of pieces) {
    if (!p.atom) continue;
    let gone = 0;
    for (let k = 0; k < p.text.length; k++) if (removed(p.pos + k)) gone++;
    if (gone > 0 && gone < p.text.length) return null;
  }
  const kept = pieces.filter((p) => !removed(p.pos));
  const context = stylesInside(state, at);
  // Its own styles plus the surrounding ones; or, where Markdown can't say
  // that, just the surrounding ones, as plain text typed there would get.
  const pasted = piecesOf(markdown).map((p) => ({
    ...p,
    styles: new Set([...(ownStyles ? p.styles : []), ...context]),
  }));
  let index = kept.findIndex((p) => p.pos >= at);
  if (index < 0) index = kept.length;
  const ends: number[] = [];
  const text = writePieces(
    shedPunctuation([...kept.slice(0, index), ...pasted, ...kept.slice(index)]),
    ends,
  );
  // The caret: just after the last pasted character, in the rewritten stretch.
  const caret = ends[index + pasted.length - 1] ?? 0;
  return { from: s.from, to: s.to, text, pasted, caret };
}

/** A line's block markers: quote marks, a list marker and task box, a heading's hashes. */
const BLOCK_PREFIX =
  /^(?:[ \t]*(?:>[ \t]?|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d{1,9}[.)][ \t]+(?:\[[ xX]\][ \t]+)?|#{1,6}[ \t]+))*/;
export const blockPrefix = (text: string) => BLOCK_PREFIX.exec(text)?.[0] ?? "";

/** A line that must stand alone: a code fence or a table row. */
const ALONE = /^[ \t]*(?:```|~~~|\|)/;
const FENCE = /^[ \t]*(?:```|~~~)/;

/**
 * What each new line after a split carries from the line it was split
 * from, as Enter would: its quote marks, and its list marker (the next
 * number, an empty task box). A heading carries to the text after the
 * cursor only.
 */
function carried(prefix: string) {
  const quote = /^(?:[ \t]*>[ \t]?)*/.exec(prefix)?.[0] ?? "";
  const rest = prefix.slice(quote.length);
  const list = /^([ \t]*)([-*+]|(\d{1,9})([.)]))([ \t]+)(\[[ xX]\][ \t]+)?/.exec(rest);
  const heading = /^#{1,6}[ \t]+/.exec(rest)?.[0] ?? "";
  let n = list?.[3] ? Number(list[3]) : 0;
  return {
    quote,
    heading,
    next(): string {
      if (!list) return quote;
      const marker = list[3] ? `${String(++n)}${list[4] ?? "."}` : (list[2] ?? "-");
      return `${quote}${list[1] ?? ""}${marker}${list[5] ?? " "}${list[6] ? "[ ] " : ""}`;
    },
  };
}

/** A rebuilt line to read back: where its text starts, and what it should show. */
export type LineCheck = { line: number; prefix: number; pieces: Piece[] };

/**
 * A line split by several pasted lines, as Markdown: the first pasted line
 * joins the text before the cursor, the last joins the text after it, and
 * each is rewritten with its marks afresh, so no format is left half open
 * across the break. Lines between go in as written. New lines carry the
 * split line's quote and list markers, as Enter does; a code fence or table
 * row pasted at either end gets a line of its own. Null when a link or code
 * would be cut into, or the line isn't prose.
 */
export function insertLines(
  state: EditorState,
  at: number,
  lines: string[],
  removed: (pos: number) => boolean,
  ownStyles = true,
): {
  from: number;
  to: number;
  lines: string[];
  checks: LineCheck[];
  caret: [number, number];
} | null {
  const line = state.doc.lineAt(at);
  const prefix = blockPrefix(line.text);
  const start = line.from + prefix.length;
  const pieces = readPieces(state, start, line.to, -1, -1);
  for (const p of pieces) {
    if (!p.atom) continue;
    let gone = 0;
    for (let k = 0; k < p.text.length; k++) if (removed(p.pos + k)) gone++;
    if (gone > 0 && gone < p.text.length) return null;
  }
  const kept = pieces.filter((p) => !removed(p.pos));
  let index = kept.findIndex((p) => p.pos >= at);
  if (index < 0) index = kept.length;
  const before = kept.slice(0, index);
  const after = kept.slice(index);
  const context = stylesInside(state, at);
  const pasted = (md: string) =>
    piecesOf(md).map((p) => ({
      ...p,
      styles: new Set([...(ownStyles ? p.styles : []), ...context]),
    }));
  const carry = carried(prefix);
  const out: string[] = [];
  const checks: LineCheck[] = [];
  const write = (lead: string, ps: Piece[], ends?: number[]) => {
    const shed = shedPunctuation(ps);
    checks.push({ line: out.length, prefix: lead.length, pieces: shed });
    out.push(lead + writePieces(shed, ends));
  };
  const first = lines[0] ?? "";
  const last = lines.at(-1) ?? "";
  const n = lines.length;
  // Which pasted lines sit inside a fenced code block: written as they are.
  const inFence: boolean[] = [];
  let open = false;
  for (const l of lines) {
    const fence = FENCE.test(l);
    inFence.push(open || fence);
    if (fence) open = !open;
  }

  // The first pasted line, joined to the text before the cursor.
  if (ALONE.test(first) || inFence[0]) {
    if (before.length > 0 || prefix !== "") write(prefix, before);
    out.push(first);
  } else {
    const own = blockPrefix(first);
    // Its own block markers stay only where nothing is before it.
    const lead = before.length === 0 && prefix === "" ? own : prefix;
    write(lead, [...before, ...pasted(first.slice(own.length))]);
  }
  // The lines between, as written; plain ones join the split line's list or quote.
  for (let k = 1; k < n - 1; k++) {
    const l = lines[k] ?? "";
    if (inFence[k] || ALONE.test(l) || l.trim() === "") out.push(l);
    else if (blockPrefix(l) !== "") out.push(l.startsWith(">") ? l : carry.quote + l);
    else out.push(carry.next() + l);
  }
  // The last pasted line, joined to the text after the cursor.
  let caret: [number, number];
  if (ALONE.test(last) || inFence[n - 1]) {
    out.push(last);
    caret = [out.length - 1, last.length];
    if (after.length > 0) write(carry.next() + carry.heading, after);
  } else {
    const own = blockPrefix(last);
    const lead =
      own !== ""
        ? (last.startsWith(">") ? "" : carry.quote) + own
        : carry.next() + (after.length > 0 ? carry.heading : "");
    const mine = pasted(last.slice(own.length));
    const ends: number[] = [];
    write(lead, [...mine, ...after], ends);
    caret = [out.length - 1, lead.length + (mine.length > 0 ? (ends[mine.length - 1] ?? 0) : 0)];
  }
  return { from: line.from, to: line.to, lines: out, checks, caret };
}
