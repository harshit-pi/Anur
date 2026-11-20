import { EditorSelection, EditorState, Transaction, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { insertNewlineContinueNumbering } from "./list-numbering.ts";
import { markdownSupport } from "./sections.ts";

/** Press Enter where "|" is; return the doc, "|" at the cursor. */
function enter(marked: string) {
  const at = marked.indexOf("|");
  let state = EditorState.create({
    doc: marked.replace("|", ""),
    selection: EditorSelection.cursor(at),
    extensions: [markdownSupport()],
  });
  const view = {
    get state() {
      return state;
    },
    dispatch(...specs: (Transaction | TransactionSpec)[]) {
      const [first] = specs;
      state =
        first instanceof Transaction
          ? first.state
          : state.update(...(specs as TransactionSpec[])).state;
    },
  } as unknown as EditorView;
  const handled = insertNewlineContinueNumbering(view);
  const text = state.doc.toString();
  const head = state.selection.main.head;
  return { handled, text: `${text.slice(0, head)}|${text.slice(head)}` };
}

describe("Enter in a numbered list", () => {
  it("renumbers the list's own items as Markdown does", () => {
    expect(enter("1. a\n2. b|\n3. c\n").text).toBe("1. a\n2. b\n3. |\n4. c\n");
  });

  it("carries on into a later list that repeats the last number", () => {
    const r = enter("1. a\n2. b|\n3. c\n\nnote\n\n3. x\n4. y\n");
    expect(r.text).toBe("1. a\n2. b\n3. |\n4. c\n\nnote\n\n5. x\n6. y\n");
  });

  it("carries on into a later list that starts at the next number", () => {
    const r = enter("1. a\n2. b|\n\nnote\n\n3. x\n4. y\n");
    expect(r.text).toBe("1. a\n2. b\n3. |\n\nnote\n\n4. x\n5. y\n");
  });

  it("goes through every list that continues, and stops at one that doesn't", () => {
    const r = enter("1. a|\n\nn\n\n2. b\n\nm\n\n3. c\n\nk\n\n1. z\n");
    expect(r.text).toBe("1. a\n2. |\n\nn\n\n3. b\n\nm\n\n4. c\n\nk\n\n1. z\n");
  });

  it("leaves a later list that is its own, starting elsewhere", () => {
    const r = enter("1. a\n2. b|\n\nnote\n\n1. x\n2. y\n");
    expect(r.text).toBe("1. a\n2. b\n3. |\n\nnote\n\n1. x\n2. y\n");
  });

  it("keeps images between items out of the way", () => {
    const r = enter("1. a|\n![[p.png|10]]\n2. b\n\nnote\n\n2. x\n");
    expect(r.text).toBe("1. a\n2. |\n![[p.png|10]]\n3. b\n\nnote\n\n4. x\n");
  });

  it("does nothing outside a numbered list", () => {
    expect(enter("hello|\n").handled).toBe(false);
  });
  it("splits an item in the middle and still carries on", () => {
    const r = enter("1. ab|cd\n2. e\n\nnote\n\n2. x\n");
    expect(r.text).toBe("1. ab\n2. |cd\n3. e\n\nnote\n\n4. x\n");
  });

  it("leaves a bullet list and a later numbered list alone", () => {
    const r = enter("- a|\n\nnote\n\n2. x\n");
    expect(r.text).toBe("- a\n- |\n\nnote\n\n2. x\n");
  });

  it("leaves numbers alone when the list has no later list", () => {
    expect(enter("1. a|\n").text).toBe("1. a\n2. |\n");
  });

  it("changes nothing later when Enter on an empty item adds and removes no item", () => {
    const r = enter("1. a\n2. |\n\nnote\n\n2. x\n3. y\n");
    expect(r.text).toBe("1. a\n\n2. |\n\nnote\n\n2. x\n3. y\n");
  });

  it("does not touch a nested list's numbers as the list's own", () => {
    const r = enter("1. a\n   1. in|\n\nnote\n\n2. x\n");
    expect(r.text).toBe("1. a\n   1. in\n   2. |\n\nnote\n\n2. x\n");
  });
});
