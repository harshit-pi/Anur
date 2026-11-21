import { EditorSelection } from "@codemirror/state";
import { BlockType, type Command, type EditorView, type KeyBinding } from "@codemirror/view";

/**
 * Up and Down when the cursor has been scrolled off screen. CodeMirror still
 * draws the cursor's line, but not the lines between it and what's on screen;
 * looking for the line above, it takes each undrawn line for padding and
 * skips it, so Up from item 28 landed on the last line drawn, item 17. When
 * the cursor's line is outside the drawn part, move one line in the text
 * itself (past image lines, as on screen) and bring the cursor into view; the
 * next press is then CodeMirror's own. On screen, these do nothing.
 */
function offscreenVertical(forward: boolean, extend: boolean): Command {
  return (view: EditorView) => {
    const { state } = view;
    const sel = state.selection.main;
    const { from, to } = view.viewport;
    if (sel.head >= from && sel.head <= to) return false;
    const doc = state.doc;
    let line = doc.lineAt(sel.head);
    const column = sel.head - line.from;
    let target = forward ? doc.length : 0;
    for (
      let n = line.number + (forward ? 1 : -1);
      n >= 1 && n <= doc.lines;
      n += forward ? 1 : -1
    ) {
      line = doc.line(n);
      // A line drawn as a block, such as an image, is stepped over, as Up and Down do on screen.
      if (view.lineBlockAt(line.from).type !== BlockType.Text) continue;
      target = line.from + Math.min(column, line.length);
      break;
    }
    view.dispatch({
      selection: extend
        ? EditorSelection.range(sel.anchor, target)
        : EditorSelection.cursor(target),
      scrollIntoView: true,
      userEvent: "select",
    });
    return true;
  };
}

/** Before the default keymap: Up and Down, with Shift to select, for a cursor off screen. */
export const offscreenArrowKeymap: KeyBinding[] = [
  { key: "ArrowUp", run: offscreenVertical(false, false), shift: offscreenVertical(false, true) },
  { key: "ArrowDown", run: offscreenVertical(true, false), shift: offscreenVertical(true, true) },
];
