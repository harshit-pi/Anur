import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorState, RangeSet, StateEffect, StateField, type Range } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import {
  BulletWidget,
  CheckboxWidget,
  type ConflictMark,
  ConflictMarkWidget,
  RuleWidget,
  TextWidget,
} from "./widgets.ts";
import { BaseWidget } from "../bases/base-widget.ts";
import {
  CalloutLabelWidget,
  CopyCodeWidget,
  EmbedWidget,
  LanguageChipWidget,
} from "../chips/chip-widgets.ts";
import { editGuard } from "../edit-guard.ts";
import { parseFields } from "../properties/properties-model.ts";
import { PropertiesWidget } from "../properties/properties-widget.ts";
import { parseTable } from "../table/table-model.ts";
import { TableWidget } from "../table/table-widget.ts";

/**
 * Live preview (task 2.6): the page renders Markdown in place, as Obsidian
 * does, while the document stays the file's exact text. Wherever a cursor or
 * selection touches, the source shows, so what is being read or edited is
 * always the real characters. Everything comes from the editor's own parse.
 */

const hide = Decoration.replace({});
const mark = (cls: string) => Decoration.mark({ class: cls });
const line = (cls: string) => Decoration.line({ class: cls });

/** The lines a cursor or selection touches; their Markdown shows as source. */
function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number;
    const last = state.doc.lineAt(r.to).number;
    for (let n = first; n <= last; n++) lines.add(n);
  }
  return lines;
}

/** Frontmatter as key and values; null when it isn't simple enough to show as properties. */
export function parseProperties(yaml: string): [string, string[]][] | null {
  return parseFields(yaml)?.fields.map((f) => [f.key, f.values]) ?? null;
}

export { splitRow } from "../table/table-model.ts";

/**
 * The decorations for a state. Unfocused, nothing counts as under the cursor,
 * so a doc just opened (cursor at the start) reads fully rendered.
 */
export function buildLivePreview(state: EditorState, focused = true): DecorationSet {
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);
  const doc = state.doc;
  const active = focused ? activeLines(state) : new Set<number>();
  /** Block elements still show source on the lines a cursor is on. */
  const isActive = (from: number, to: number) => {
    const a = doc.lineAt(from).number;
    const b = doc.lineAt(to).number;
    for (let n = a; n <= b; n++) if (active.has(n)) return true;
    return false;
  };
  const out: Range<Decoration>[] = [];
  const text = (from: number, to: number) => doc.sliceString(from, to);
  /** Hide a mark and the spaces after it on the same line. */
  const hideWithSpace = (from: number, to: number) => {
    let end = to;
    const lineEnd = doc.lineAt(from).to;
    while (end < lineEnd && text(end, end + 1) === " ") end++;
    if (end > from) out.push(hide.range(from, end));
  };
  const children = (node: SyntaxNode, name: string) => {
    const found: SyntaxNode[] = [];
    for (let c = node.firstChild; c; c = c.nextSibling) if (c.name === name) found.push(c);
    return found;
  };

  // Which side of a merge conflict the lines being passed are on, and where it began.
  let conflictSide: "ours" | "base" | "theirs" | null = null;
  let conflictFrom = 0;
  tree.iterate({
    enter(ref) {
      const node = ref.node;
      const { from, to, name } = node;
      if (to <= from) return;

      switch (name) {
        case "Frontmatter": {
          // Never YAML on the page: its fields are typed into in place (2.13).
          // YAML too intricate to show as fields stays as written.
          const body = text(from, to).split("\n").slice(1, -1).join("\n");
          const props = parseFields(body);
          if (props)
            out.push(
              Decoration.replace({ widget: new PropertiesWidget(props), block: true }).range(
                from,
                to,
              ),
            );
          return false;
        }
        case "Table": {
          // Never Markdown: its cells are typed into in place (2.9).
          const table = parseTable(text(from, to));
          if (table) {
            out.push(
              Decoration.replace({ widget: new TableWidget(table), block: true }).range(from, to),
            );
          }
          return false;
        }
        case "ConflictMarker": {
          // Git's conflict markers as labels, each side tinted (2.19).
          const marker = text(from, to);
          const kind: ConflictMark = marker.startsWith("<")
            ? "open"
            : marker.startsWith("|")
              ? "base"
              : marker.startsWith("=")
                ? "middle"
                : "close";
          if (conflictSide && conflictFrom < from) {
            for (let n = doc.lineAt(conflictFrom).number; n < doc.lineAt(from).number; n++) {
              out.push(line(`cm-lp-conflict-${conflictSide}`).range(doc.line(n).from));
            }
          }
          out.push(
            line("cm-lp-conflict-marker").range(from),
            Decoration.replace({
              widget: new ConflictMarkWidget(kind, marker.slice(7).trim()),
            }).range(from, to),
          );
          conflictSide =
            kind === "open"
              ? "ours"
              : kind === "base"
                ? "base"
                : kind === "middle"
                  ? "theirs"
                  : null;
          conflictFrom = Math.min(doc.length, to + 1);
          return false;
        }
        case "HorizontalRule":
          if (!isActive(from, to))
            out.push(Decoration.replace({ widget: new RuleWidget() }).range(from, to));
          return false;
        case "FencedCode":
        case "CodeBlock":
          for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) {
            out.push(line("cm-lp-codeblock").range(doc.line(n).from));
          }
          // Fences never show (2.14): the opening one is a chip naming the
          // language, the closing one is hidden.
          if (name === "FencedCode") {
            const marks = children(node, "CodeMark");
            const open = marks[0];
            const close = marks.length > 1 ? marks.at(-1) : undefined;
            const info = children(node, "CodeInfo")[0];
            if (open) {
              out.push(
                Decoration.replace({
                  widget: new LanguageChipWidget(info ? text(info.from, info.to) : ""),
                }).range(open.from, info ? info.to : open.to),
              );
            }
            if (close) out.push(hide.range(close.from, close.to));
            out.push(
              Decoration.widget({ widget: new CopyCodeWidget(), side: 1 }).range(
                doc.lineAt(from).to,
              ),
            );
          }
          return false;
        case "Blockquote": {
          const firstLine = doc.lineAt(from);
          const callout = /^\s*>\s?\[!([A-Za-z]+)\][+-]?/.exec(firstLine.text);
          const kind = callout?.[1]?.toLowerCase();
          for (let n = firstLine.number; n <= doc.lineAt(to).number; n++) {
            const cls = kind
              ? `cm-lp-callout cm-lp-callout-${kind}${n === firstLine.number ? " cm-lp-callout-first" : ""}`
              : "cm-lp-quote";
            out.push(line(cls).range(doc.line(n).from));
          }
          const start = firstLine.from + firstLine.text.indexOf("[!");
          const end = firstLine.from + (callout?.[0].length ?? 0);
          // The type never shows as "[!note]" (2.14): it's a chip that changes it.
          if (kind && callout) {
            out.push(
              Decoration.replace({ widget: new CalloutLabelWidget(kind) }).range(start, end),
            );
          }
          return;
        }
        // A heading's "#"s, a quote's ">" and a list's marker never show
        // (2.8): the cursor steps over them, and Backspace removes them whole.
        case "QuoteMark":
          hideWithSpace(from, to);
          return;
        case "HeaderMark": {
          const parent = node.parent?.name ?? "";
          if (parent.startsWith("SetextHeading")) out.push(hide.range(from, to));
          else hideWithSpace(from, to);
          return;
        }
        // Inline marks never show either (2.11): the cursor steps over them,
        // and typing at a mark's edge continues that formatting.
        case "EmphasisMark":
        case "StrikethroughMark":
          out.push(hide.range(from, to));
          return;
        case "InlineCode": {
          const marks = children(node, "CodeMark");
          const [open, close] = [marks[0], marks.at(-1)];
          if (open && close && open !== close) {
            out.push(hide.range(open.from, open.to), hide.range(close.from, close.to));
            if (open.to < close.from) out.push(mark("cm-lp-code").range(open.to, close.from));
          }
          return false;
        }
        case "Link": {
          // Descends, so bold or code inside the link text renders too. The
          // address is edited in the link's pop-up (link-editor.ts).
          const marks = children(node, "LinkMark");
          const open = marks[0];
          const close = marks[1];
          // Only an inline link, "[text](address)"; "[text]" alone, as in a
          // callout's "[!note]", is shown as written.
          if (!open || !close || marks.length < 3) return;
          out.push(hide.range(open.from, open.to));
          if (open.to < close.from) out.push(mark("cm-lp-link").range(open.to, close.from));
          out.push(hide.range(close.from, to));
          return;
        }
        // A bare web address, or one in <angle brackets>: shown as a link, which a click follows.
        case "Autolink": {
          const url = children(node, "URL")[0];
          for (const m of children(node, "LinkMark")) out.push(hide.range(m.from, m.to));
          if (url) out.push(mark("cm-lp-link").range(url.from, url.to));
          return false;
        }
        case "URL":
          if (!/^(Link|Image|Autolink)$/.test(node.parent?.name ?? "")) {
            out.push(mark("cm-lp-link").range(from, to));
          }
          return;
        case "Image":
          {
            const url = children(node, "URL")[0];
            const label = url ? text(url.from, url.to) : text(from, to);
            out.push(Decoration.replace({ widget: new EmbedWidget(label) }).range(from, to));
          }
          return false;
        case "WikiEmbed":
          {
            const target = children(node, "WikiLinkTarget")[0];
            const name = target ? text(target.from, target.to) : "";
            const line = doc.lineAt(from);
            // A base alone on its line is drawn as its table.
            if (/\.base$/i.test(name) && line.text.trim() === text(from, to)) {
              const heading = children(node, "WikiLinkHeading")[0];
              const at = heading ? `${name}#${text(heading.from, heading.to)}` : name;
              out.push(
                Decoration.replace({ widget: new BaseWidget(at), block: true }).range(
                  line.from,
                  line.to,
                ),
              );
              return false;
            }
            out.push(
              Decoration.replace({
                widget: new EmbedWidget(target ? text(target.from, target.to) : ""),
              }).range(from, to),
            );
          }
          return false;
        case "WikiLink": {
          const target = children(node, "WikiLinkTarget")[0];
          const heading = children(node, "WikiLinkHeading")[0];
          const alias = children(node, "WikiLinkAlias")[0];
          if (alias) {
            out.push(
              hide.range(from, alias.from),
              mark("cm-lp-link").range(alias.from, alias.to),
              hide.range(alias.to, to),
            );
            return false;
          }
          const shown = [target, heading].filter((n): n is SyntaxNode => Boolean(n));
          const [first, second] = shown;
          if (!first) return false;
          out.push(hide.range(from, first.from), mark("cm-lp-link").range(first.from, first.to));
          if (second) {
            out.push(
              Decoration.replace({ widget: new TextWidget(" › ", "cm-lp-link") }).range(
                first.to,
                second.from,
              ),
              mark("cm-lp-link").range(second.from, second.to),
            );
          }
          out.push(hide.range((second ?? first).to, to));
          return false;
        }
        case "ListMark": {
          const listName = node.parent?.parent?.name;
          const task = node.parent ? children(node.parent, "Task")[0] : undefined;
          if (listName === "BulletList" && !task) {
            const space = text(to, to + 1) === " " ? 1 : 0;
            out.push(Decoration.replace({ widget: new BulletWidget() }).range(from, to + space));
          } else if (task) out.push(hide.range(from, to + (text(to, to + 1) === " " ? 1 : 0)));
          return;
        }
        case "TaskMarker": {
          const checked = /x/i.test(text(from, to));
          const space = text(to, to + 1) === " " ? 1 : 0;
          out.push(
            Decoration.replace({ widget: new CheckboxWidget(checked) }).range(from, to + space),
          );
          return;
        }
        default:
          return;
      }
    },
  });

  // An empty pair such as "****", left by ⌘B with nothing selected, hides
  // while the cursor waits between its marks for the text to make bold.
  if (focused) {
    const pos = state.selection.main.head;
    const m = emptyPairAt(state.doc, pos);
    if (m) out.push(hide.range(pos - m.length, pos), hide.range(pos, pos + m.length));
  }

  return Decoration.set(out, true);
}

/** Marks ⌘B, ⌘I, ⌘⇧X and code can leave empty around the cursor, longest first. */
export const EMPTY_PAIRS = ["**", "~~", "*", "`"];

/**
 * The mark of an empty pair around `pos`, such as "****", or null. The pair
 * must stand alone: "```" or "*****" around the cursor is something else,
 * such as a code fence, and is never hidden or removed.
 */
export function emptyPairAt(doc: EditorState["doc"], pos: number): string | null {
  for (const m of EMPTY_PAIRS) {
    const n = m.length;
    const c = m.charAt(0);
    if (
      doc.sliceString(pos - n, pos) === m &&
      doc.sliceString(pos, pos + n) === m &&
      doc.sliceString(pos - n - 1, pos - n) !== c &&
      doc.sliceString(pos + n, pos + n + 1) !== c
    ) {
      return m;
    }
  }
  return null;
}

const setFocused = StateEffect.define<boolean>();

type Preview = { focused: boolean; decorations: DecorationSet; atomic: RangeSet<Decoration> };

/** What live preview hides or replaces: the cursor treats each as one unit. */
function atomicOf(decorations: DecorationSet): RangeSet<Decoration> {
  const ranges: Range<Decoration>[] = [];
  decorations.between(0, Number.MAX_SAFE_INTEGER, (from, to, deco) => {
    if (to > from && (deco.spec as { class?: string }).class === undefined) {
      ranges.push(deco.range(from, to));
    }
  });
  return RangeSet.of(ranges, true);
}

function preview(state: EditorState, focused: boolean): Preview {
  const decorations = buildLivePreview(state, focused);
  return { focused, decorations, atomic: atomicOf(decorations) };
}

const previewField = StateField.define<Preview>({
  create: (state) => preview(state, false),
  update(value, tr) {
    let focused = value.focused;
    for (const e of tr.effects) if (e.is(setFocused)) focused = e.value;
    const stale =
      focused !== value.focused ||
      tr.docChanged ||
      tr.selection ||
      syntaxTree(tr.startState) !== syntaxTree(tr.state);
    return stale ? preview(tr.state, focused) : value;
  },
  provide: (field) => [
    EditorView.decorations.from(field, (v) => v.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field).atomic),
  ],
});

/**
 * Where a line's text starts once its hidden prefix ("## ", "> ", "- [ ] ")
 * is skipped, or null when it has none. A cursor never rests before such a
 * prefix, so typing at the start of a heading types into the heading.
 */
export function textStart(state: EditorState, lineFrom: number): number | null {
  const { atomic } = state.field(previewField);
  const line = state.doc.lineAt(lineFrom);
  let pos = line.from;
  while (pos < line.to && /[ \t]/.test(state.sliceDoc(pos, pos + 1))) pos++;
  let moved = false;
  for (;;) {
    let next = -1;
    atomic.between(pos, pos, (from, to) => {
      if (from === pos && to > next) next = to;
    });
    if (next <= pos) break;
    pos = next;
    moved = true;
  }
  return moved ? pos : null;
}

const skipPrefix = EditorState.transactionFilter.of((tr) => {
  if (tr.docChanged || !tr.selection) return tr;
  const sel = tr.selection;
  if (sel.ranges.length !== 1 || !sel.main.empty) return tr;
  const head = sel.main.head;
  const line = tr.state.doc.lineAt(head);
  if (head !== line.from) return tr;
  const start = textStart(tr.state, line.from);
  if (start === null) return tr;
  // Moving left from the text's start goes on to the line before, as in a doc.
  const before = tr.startState.selection.main.head;
  const target = before === start && line.from > 0 ? line.from - 1 : start;
  return [tr, { selection: { anchor: target }, sequential: true }];
});

/** An empty pair the cursor leaves without typing into it is removed. */
const dropEmptyPair = EditorState.transactionFilter.of((tr) => {
  if (tr.docChanged || !tr.selection) return tr;
  const before = tr.startState.selection.main;
  if (!before.empty || tr.selection.main.head === before.head) return tr;
  const pos = before.head;
  const m = emptyPairAt(tr.startState.doc, pos);
  if (!m) return tr;
  return [tr, { changes: { from: pos - m.length, to: pos + m.length }, sequential: true }];
});

/** Live preview for a page: the decorations, kept in step with focus. */
export const livePreview = [
  previewField,
  // With marks hidden, edits must keep them valid (edit-guard.ts).
  editGuard,
  skipPrefix,
  dropEmptyPair,
  EditorView.focusChangeEffect.of((_, focusing) => setFocused.of(focusing)),
];
