import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import { BlockType, type EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { offscreenArrowKeymap } from "./offscreen-arrows.ts";

const doc = [
  "1. one", // line 1
  "2. two", // 2
  "![[a.png|100]]", // 3, drawn as a block
  "3. three", // 4
  "4. four", // 5
  "5. five", // 6
].join("\n");

/** Press a key with the cursor at `line` col `col`, the drawn part of the doc being `viewport`. */
function press(
  key: "ArrowUp" | "ArrowDown",
  line: number,
  viewport: { from: number; to: number },
  opts: { shift?: boolean; col?: number } = {},
) {
  let state = EditorState.create({ doc });
  const at = state.doc.line(line).from + (opts.col ?? 0);
  state = state.update({ selection: EditorSelection.cursor(at) }).state;
  let scrolled = false;
  const view = {
    get state() {
      return state;
    },
    viewport,
    lineBlockAt: (pos: number) => ({
      type: state.doc.lineAt(pos).number === 3 ? BlockType.WidgetRange : BlockType.Text,
    }),
    dispatch(spec: TransactionSpec) {
      scrolled = !!spec.scrollIntoView;
      state = state.update(spec).state;
    },
  } as unknown as EditorView;
  const binding = offscreenArrowKeymap.find((b) => b.key === key);
  const run = opts.shift ? binding?.shift : binding?.run;
  const handled = run?.(view) ?? false;
  const sel = state.selection.main;
  return {
    handled,
    scrolled,
    line: state.doc.lineAt(sel.head).number,
    col: sel.head - state.doc.lineAt(sel.head).from,
    anchorLine: state.doc.lineAt(sel.anchor).number,
  };
}

const top = { from: 0, to: 10 }; // only line 1 and part of 2 drawn

describe("Up and Down with the cursor off screen", () => {
  it("leave a cursor on screen to CodeMirror", () => {
    expect(press("ArrowUp", 1, top).handled).toBe(false);
  });

  it("move up one line, not to the edge of what's drawn, and scroll to it", () => {
    expect(press("ArrowUp", 6, top)).toMatchObject({ handled: true, line: 5, scrolled: true });
  });

  it("step over an image line, as on screen", () => {
    expect(press("ArrowUp", 4, top).line).toBe(2);
    expect(press("ArrowDown", 2, { from: 40, to: 55 }).line).toBe(4);
  });

  it("move down one line when scrolled past the cursor", () => {
    expect(press("ArrowDown", 1, { from: 40, to: 55 }).line).toBe(2);
  });

  it("keep the column, or the line's end if it is shorter", () => {
    expect(press("ArrowUp", 6, top, { col: 4 }).col).toBe(4);
    expect(press("ArrowDown", 4, top, { col: 8 })).toMatchObject({ line: 5, col: 7 });
  });

  it("extend the selection with Shift", () => {
    expect(press("ArrowUp", 6, top, { shift: true })).toMatchObject({ line: 5, anchorLine: 6 });
  });

  it("go to the doc's end from the last line", () => {
    const end = { from: 0, to: 5 };
    expect(press("ArrowDown", 6, end, { col: 2 })).toMatchObject({ line: 6, col: 7 });
  });
});
