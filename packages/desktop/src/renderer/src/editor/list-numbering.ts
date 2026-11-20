import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { ChangeSpec, EditorState, Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/**
 * Numbers that carry on across a paragraph. Markdown calls a numbered list
 * that follows a paragraph a new list, so adding an item to the first one
 * left the second one's numbers where they were, and 9 and 10 showed twice.
 * A person writing "1. … 9." then a note, then "9. …" means one sequence;
 * when Enter adds an item to a numbered list, every later list that picked up
 * where this one ended (its first number is this list's last, or the one
 * after) is numbered on from the new last, until a list that doesn't.
 */

interface Mark {
  from: number;
  to: number;
  num: number;
}

interface NumberedList {
  from: number;
  to: number;
  marks: Mark[];
}

/** The top-level numbered lists of the doc, each as its numbers' places. */
function numberedLists(state: EditorState): NumberedList[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);
  const lists: NumberedList[] = [];
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    if (node.name !== "OrderedList") continue;
    const marks: Mark[] = [];
    for (let item = node.firstChild; item; item = item.nextSibling) {
      if (item.name !== "ListItem") continue;
      const mark = item.getChild("ListMark");
      if (!mark) continue;
      const m = /^(\d{1,9})[.)]/.exec(state.sliceDoc(mark.from, mark.to));
      if (m?.[1]) marks.push({ from: mark.from, to: mark.from + m[1].length, num: Number(m[1]) });
    }
    if (marks.length > 0) lists.push({ from: node.from, to: node.to, marks });
  }
  return lists;
}

/**
 * The number changes for the lists after the one the cursor is in, given the
 * doc before Enter and the transaction Enter made. Positions are in the doc
 * after it. The later lists are read from the doc before, which Enter didn't
 * touch, since Enter before an image line can split the list it adds to.
 */
export function continuedNumbers(before: EditorState, tr: Transaction): ChangeSpec[] {
  const was = numberedLists(before);
  const head = before.selection.main.head;
  const at = was.findIndex((l) => head >= l.from && head <= l.to);
  const later = at < 0 ? [] : was.slice(at + 1);
  const firstLater = later[0];
  if (!firstLater) return [];

  // Where the numbers stand now: the last one, moved by the items Enter added or took away.
  // Counted as lines, not parsed: Enter before an image line leaves "3. b" inside a paragraph.
  const items = (text: string) => text.match(/^\d{1,9}[.)](?:\s|$)/gm)?.length ?? 0;
  const listFrom = was[at]?.from ?? 0;
  const stop = tr.changes.mapPos(firstLater.from, 1);
  const delta =
    items(tr.state.sliceDoc(tr.changes.mapPos(listFrom, -1), stop)) -
    items(before.sliceDoc(listFrom, firstLater.from));
  let oldLast = was[at]?.marks.at(-1)?.num ?? 0;
  let newLast = oldLast + delta;
  if (delta === 0) return [];

  const changes: ChangeSpec[] = [];
  for (const next of later) {
    const first = next.marks[0]?.num;
    if (first === undefined || (first !== oldLast && first !== oldLast + 1)) break;
    oldLast = next.marks.at(-1)?.num ?? first;
    next.marks.forEach((mark, k) => {
      const num = newLast + 1 + k;
      if (num === mark.num) return;
      changes.push({
        from: tr.changes.mapPos(mark.from, 1),
        to: tr.changes.mapPos(mark.to, -1),
        insert: String(num),
      });
    });
    newLast += next.marks.length;
  }
  return changes;
}

/**
 * Enter in a list, as Markdown's own command does it (a new item, the list's
 * numbers after it renumbered), then the lists that carry on from it, in the
 * same undo step.
 */
export function insertNewlineContinueNumbering(view: EditorView): boolean {
  const made: { tr?: Transaction } = {};
  const ok = insertNewlineContinueMarkup({
    state: view.state,
    dispatch: (tr) => {
      made.tr = tr;
    },
  });
  const tr = made.tr;
  if (!ok || !tr) return false;
  const extra = continuedNumbers(view.state, tr);
  if (extra.length === 0) {
    view.dispatch(tr);
    return true;
  }
  view.dispatch(
    view.state.update(
      {
        changes: tr.changes,
        selection: tr.selection,
        userEvent: "input",
        scrollIntoView: true,
      },
      { changes: extra, sequential: true },
    ),
  );
  return true;
}
