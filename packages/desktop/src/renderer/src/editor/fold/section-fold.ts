import {
  codeFolding,
  foldEffect,
  foldKeymap,
  foldable,
  foldedRanges,
  syntaxTree,
  unfoldEffect,
} from "@codemirror/language";
import { EditorState, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

/**
 * Folding a section, as Quip does: pointing anywhere in a section shows an
 * arrow left of its heading; a click folds the section up to the next
 * heading of its level or higher, and a folded section keeps its arrow, with
 * "…" after the heading to open it again. The file is never changed.
 * Folds are kept per doc while Anur runs, so switching tabs keeps them.
 */

const HEADING = /^(ATXHeading[1-6]|SetextHeading[12])$/;

/** Each heading line's start, in the doc's order. */
function headingStarts(state: EditorState, from = 0, to = state.doc.length): number[] {
  const out: number[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (HEADING.test(node.name)) {
        out.push(state.doc.lineAt(node.from).from);
        return false;
      }
      return undefined;
    },
  });
  return out;
}

/** The part a heading folds: from its line's end to the end of its section. */
export function sectionRange(state: EditorState, lineStart: number) {
  const line = state.doc.lineAt(lineStart);
  return foldable(state, line.from, line.to);
}

const isFolded = (state: EditorState, lineStart: number) => {
  const end = state.doc.lineAt(lineStart).to;
  let found = false;
  foldedRanges(state).between(end, end + 1, (from) => {
    if (from === end) found = true;
  });
  return found;
};

/** Fold or unfold the section whose heading starts its line at `lineStart`. */
export function toggleSection(view: EditorView, lineStart: number): boolean {
  const range = sectionRange(view.state, lineStart);
  if (!range) return false;
  const folded: { from: number; to: number }[] = [];
  foldedRanges(view.state).between(range.from, range.from + 1, (from, to) => {
    if (from === range.from) folded.push({ from, to });
  });
  view.dispatch({
    effects: folded.length > 0 ? folded.map((r) => unfoldEffect.of(r)) : foldEffect.of(range),
  });
  return true;
}

/** Which heading's arrow shows: the one whose section the pointer is in. */
const setHovered = StateEffect.define<number | null>();
const hovered = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setHovered)) return e.value;
    return tr.docChanged && value !== null ? tr.changes.mapPos(value) : value;
  },
});

class FoldArrow extends WidgetType {
  constructor(
    readonly lineStart: number,
    readonly folded: boolean,
    readonly shown: boolean,
  ) {
    super();
  }
  override eq(other: FoldArrow) {
    return (
      other.lineStart === this.lineStart &&
      other.folded === this.folded &&
      other.shown === this.shown
    );
  }
  toDOM(view: EditorView) {
    const button = document.createElement("span");
    button.className = `cm-fold-arrow${this.folded ? " folded" : ""}${this.shown ? " shown" : ""}`;
    button.setAttribute("role", "button");
    button.setAttribute("aria-label", this.folded ? "Show this section" : "Fold this section");
    button.title = this.folded ? "Show this section" : "Fold this section";
    button.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const line = view.state.doc.lineAt(Math.min(view.posAtDOM(button), view.state.doc.length));
      toggleSection(view, line.from);
    });
    return button;
  }
  override ignoreEvent() {
    return true;
  }
}

/** The heading whose section holds `pos`: the nearest one above it whose fold reaches it. */
export function sectionAt(state: EditorState, pos: number): number | null {
  const starts = headingStarts(state, 0, Math.min(state.doc.length, state.doc.lineAt(pos).to));
  for (let i = starts.length - 1; i >= 0; i--) {
    const start = starts[i] ?? 0;
    const range = sectionRange(state, start);
    if (start === state.doc.lineAt(pos).from || (range && pos <= range.to)) return start;
  }
  return null;
}

const arrows = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      const moved = u.transactions.some((t) => t.effects.some((e) => e.is(setHovered)));
      const folds =
        foldedRanges(u.startState) !== foldedRanges(u.state) ||
        u.transactions.some((t) => t.effects.some((e) => e.is(foldEffect) || e.is(unfoldEffect)));
      if (u.docChanged || u.viewportChanged || moved || folds)
        this.decorations = this.build(u.view);
    }
    build(view: EditorView): DecorationSet {
      const b = new RangeSetBuilder<Decoration>();
      const over = view.state.field(hovered);
      for (const { from, to } of view.visibleRanges) {
        for (const start of headingStarts(view.state, from, to)) {
          if (!sectionRange(view.state, start)) continue;
          const folded = isFolded(view.state, start);
          b.add(
            start,
            start,
            Decoration.widget({
              widget: new FoldArrow(start, folded, folded || over === start),
              side: -1,
            }),
          );
        }
      }
      return b.finish();
    }
  },
  {
    decorations: (p) => p.decorations,
    eventHandlers: {
      mousemove(e, view) {
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }, false);
        const at = sectionAt(view.state, pos);
        if (at !== view.state.field(hovered)) view.dispatch({ effects: setHovered.of(at) });
      },
      mouseleave(_e, view) {
        if (view.state.field(hovered) !== null) view.dispatch({ effects: setHovered.of(null) });
      },
    },
  },
);

/** Folded headings per doc, by their line's text, kept while Anur runs. */
const remembered = new Map<string, string[]>();

/** Fold again the headings this doc had folded when it was last shown. */
export function restoreFolds(view: EditorView, path: string) {
  const want = remembered.get(path);
  if (!want?.length) return;
  const left = [...want];
  const effects: StateEffect<unknown>[] = [];
  for (const start of headingStarts(view.state)) {
    const at = left.indexOf(view.state.doc.lineAt(start).text);
    const range = at >= 0 ? sectionRange(view.state, start) : null;
    if (range) {
      effects.push(foldEffect.of(range));
      left.splice(at, 1);
    }
  }
  if (effects.length) view.dispatch({ effects });
}

/** Remember which headings are folded, whenever that changes. */
const remember = (path: string) =>
  EditorView.updateListener.of((u) => {
    if (foldedRanges(u.startState) === foldedRanges(u.state)) return;
    const texts: string[] = [];
    foldedRanges(u.state).between(0, u.state.doc.length, (from) => {
      texts.push(u.state.doc.lineAt(from).text);
    });
    remembered.set(path, texts);
  });

/** The "…" after a folded heading: a click opens the section. */
function placeholder(_view: EditorView, onclick: (e: Event) => void) {
  const dots = document.createElement("span");
  dots.className = "cm-fold-dots";
  dots.textContent = "…";
  dots.title = "Show this section";
  dots.addEventListener("click", onclick);
  return dots;
}

/** A cursor sent into a folded section, as by the outline or a search, opens it. */
const revealCursor = EditorState.transactionExtender.of((tr) => {
  if (!tr.selection) return null;
  const head = tr.selection.main.head;
  const opened: StateEffect<unknown>[] = [];
  foldedRanges(tr.startState).between(head, head, (from, to) => {
    if (head > from && head <= to) opened.push(unfoldEffect.of({ from, to }));
  });
  return opened.length ? { effects: opened } : null;
});

export function sectionFolding(path: string) {
  return [
    codeFolding({ placeholderDOM: placeholder }),
    hovered,
    arrows,
    remember(path),
    revealCursor,
    keymap.of(foldKeymap),
  ];
}
