import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { editorFilter } from "./editor-filter.ts";

const start = () =>
  EditorState.create({ doc: "Decided text.", extensions: [editorFilter, history()] });
const edit = (userEvent?: string) =>
  start()
    .update({ changes: { from: 0, insert: "X" }, ...(userEvent ? { userEvent } : {}) })
    .state.doc.toString();

describe("the editor filter", () => {
  it.each([
    "input.type",
    "input.type.compose",
    "input.paste",
    "input.drop",
    "input.replace",
    "input.complete",
    "input.format",
    "input.table",
    "delete.backward",
    "move.line",
    "outside",
  ])("lets a change tagged %s through", (tag) => {
    expect(edit(tag)).toBe("XDecided text.");
  });

  it("drops a change with no tag", () => {
    expect(edit()).toBe("Decided text.");
  });

  it("drops a change with a tag that isn't one of Anur's", () => {
    expect(edit("plugin.rewrite")).toBe("Decided text.");
    expect(edit("inputs")).toBe("Decided text.");
  });

  it("lets undo take back a typed change", () => {
    let state = start().update({
      changes: { from: 0, insert: "X" },
      userEvent: "input.type",
    }).state;
    undo({
      state,
      dispatch: (tr) => {
        state = tr.state;
      },
    });
    expect(state.doc.toString()).toBe("Decided text.");
  });
});
