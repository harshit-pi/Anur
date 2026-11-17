import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  startCompletion,
} from "@codemirror/autocomplete";
import { EditorSelection, Facet, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { INSERT_ITEMS, type InsertId } from "../../../shared/insert-items.ts";
import { blankTable } from "./table/table-model.ts";
import { focusTableWhenDrawn } from "./table/table-widget.ts";

/**
 * The insert menu (task 2.10). "/" at the start of a line or after a space
 * opens it; typing filters it; Enter inserts; Escape closes it and keeps
 * the "/". Everything it inserts is plain Markdown. "[[" opens the same kind
 * of list for a link to a doc in the folder.
 */

/** The folder's docs, for "[[" links. */
export const folderDocs = Facet.define<readonly string[], readonly string[]>({
  combine: (values) => values[0] ?? [],
});

/** Replace what was typed to open the menu, then edit the line it sat on. */
function onLine(edit: (line: { from: number; text: string }) => { prefix: string }) {
  return (view: EditorView, _c: Completion, from: number, to: number) => {
    const { state } = view;
    const line = state.doc.lineAt(from);
    const typedStart = from - line.from;
    const rest = line.text.slice(0, typedStart).trimEnd() + line.text.slice(to - line.from);
    const body = rest.replace(
      /^(#{1,6}\s+|>\s?(\[![a-z]+\]\s*)?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/i,
      "",
    );
    const { prefix } = edit({ from: line.from, text: body });
    const insert = prefix + body;
    view.dispatch({
      changes: { from: line.from, to: line.to, insert },
      selection: { anchor: line.from + insert.length },
      userEvent: "input.complete",
    });
  };
}

/** Insert a block on its own lines, with a blank line before and after it. */
function block(text: string, cursorOffset: number | "end", after?: (from: number) => void) {
  return (view: EditorView, _c: Completion, from: number, to: number) => {
    const { state } = view;
    const line = state.doc.lineAt(from);
    const before = state.sliceDoc(line.from, from).trimEnd();
    const tail = state.sliceDoc(to, line.to);
    const lead = before ? `${before}\n\n` : "";
    const prevBlank = line.number === 1 || state.doc.line(line.number - 1).text.trim() === "";
    const opening = before || prevBlank ? "" : "\n";
    const nextBlank =
      line.number === state.doc.lines || state.doc.line(line.number + 1).text.trim() === "";
    const closing = tail.trim() ? `\n\n${tail.trim()}` : nextBlank ? "" : "\n";
    const insert = opening + lead + text + closing;
    const start = line.from + opening.length + lead.length;
    const cursor = cursorOffset === "end" ? start + text.length : start + cursorOffset;
    // Before the dispatch: a table is drawn during it.
    after?.(start);
    view.dispatch({
      changes: { from: line.from, to: line.to, insert },
      selection: EditorSelection.cursor(cursor),
      userEvent: "input.complete",
      scrollIntoView: true,
    });
  };
}

type Apply = (view: EditorView, c: Completion, from: number, to: number) => void;

/** What each item does, given the range of what was typed to ask for it. */
const APPLY: Record<InsertId, Apply> = {
  table: block(blankTable(3, 2), 0, (from) => {
    focusTableWhenDrawn(from, 0, 0);
  }),
  h1: onLine(() => ({ prefix: "# " })),
  h2: onLine(() => ({ prefix: "## " })),
  h3: onLine(() => ({ prefix: "### " })),
  body: onLine(() => ({ prefix: "" })),
  bullets: onLine(() => ({ prefix: "- " })),
  numbers: onLine(() => ({ prefix: "1. " })),
  tasks: onLine(() => ({ prefix: "- [ ] " })),
  note: onLine(() => ({ prefix: "> [!note] " })),
  tip: onLine(() => ({ prefix: "> [!tip] " })),
  warning: onLine(() => ({ prefix: "> [!warning] " })),
  code: block("```\n\n```", 4),
  divider: block("---", "end"),
  link: (view, _c, from, to) => {
    view.dispatch({
      changes: { from, to, insert: "[[]]" },
      selection: { anchor: from + 2 },
      userEvent: "input.complete",
    });
    startCompletion(view);
  },
};

const ITEMS: (Completion & { id: InsertId })[] = INSERT_ITEMS.map((item) => ({
  id: item.id,
  label: item.label,
  detail: "keys" in item ? item.keys : "detail" in item ? item.detail : "",
  apply: APPLY[item.id],
}));

/** Insert from the menu bar: the block goes where the cursor is. */
export function insertById(view: EditorView, id: InsertId): void {
  const pos = view.state.selection.main.head;
  APPLY[id](view, { label: id }, pos, pos);
}

/** "/" at the start of a line or after a space, then letters. */
export function slashMenu(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/(?:^|\s)\/[\w ]*$/);
  if (!match) return null;
  const slash = match.text.indexOf("/");
  // "/ " is prose, not the menu.
  if (match.text.slice(slash + 1).startsWith(" ")) return null;
  // The query is what follows the "/"; each item also removes the "/".
  const from = match.from + slash + 1;
  // In the order listed, rather than alphabetical, until a query ranks them.
  const options = ITEMS.map((item, i) => ({
    ...item,
    boost: 99 - i,
    apply: (view: EditorView, c: Completion, f: number, t: number) => {
      APPLY[item.id](view, c, f - 1, t);
    },
  }));
  return { from, options, validFor: /^[\w ]*$/ };
}

/** "[[" then a doc's name: links to a doc in the folder, by name, as Obsidian writes them. */
export function docLinks(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/\[\[[^\]|#\n]*$/);
  if (!match) return null;
  const docs = context.state.facet(folderDocs);
  const options: Completion[] = docs.map((path) => {
    const name = (path.split("/").pop() ?? path).replace(/\.md$/i, "");
    return {
      label: name,
      ...(path.includes("/") ? { detail: path.slice(0, path.lastIndexOf("/")) } : {}),
      apply: (view, _c, from, to) => {
        const closed = view.state.sliceDoc(to, to + 2) === "]]";
        view.dispatch({
          changes: { from, to: closed ? to + 2 : to, insert: `${name}]]` },
          selection: { anchor: from + name.length + 2 },
          userEvent: "input.complete",
        });
      },
    };
  });
  return { from: match.from + 2, options, validFor: /^[^\]|#\n]*$/ };
}

export function insertMenu(docs: readonly string[]): Extension {
  return [
    folderDocs.of(docs),
    autocompletion({ override: [slashMenu, docLinks], icons: false, closeOnBlur: true }),
  ];
}
