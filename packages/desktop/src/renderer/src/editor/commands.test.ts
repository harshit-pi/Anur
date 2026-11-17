import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import type { Command, EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { insertLink, setHeading, toggleList, toggleMark, toggleTask } from "./commands.ts";

/** Run a command on a doc with the selection marked by "|" (cursor) or "[" and "]". */
function run(command: Command, marked: string) {
  const from = marked.includes("[") ? marked.indexOf("[") : marked.indexOf("|");
  const to = marked.includes("]") ? marked.indexOf("]") - 1 : from;
  const doc = marked.replace(/[|[\]]/g, "");
  let state = EditorState.create({
    doc,
    selection: EditorSelection.range(from, to),
  });
  const view = {
    get state() {
      return state;
    },
    dispatch(...specs: TransactionSpec[]) {
      state = state.update(...specs).state;
    },
  } as unknown as EditorView;
  const handled = command(view);
  const sel = state.selection.main;
  return { handled, text: state.doc.toString(), sel: [sel.from, sel.to], state };
}

describe("formatting commands", () => {
  it("⌘⌥2 makes a line a heading, and ⌘⌥0 makes it body text", () => {
    expect(run(setHeading(2), "Ti|tle").text).toBe("## Title");
    expect(run(setHeading(1), "### Ti|tle").text).toBe("# Title");
    expect(run(setHeading(0), "## Ti|tle").text).toBe("Title");
  });

  it("sets the level of every selected line", () => {
    expect(run(setHeading(3), "[a\nb]").text).toBe("### a\n### b");
  });

  it("⌘B wraps and unwraps the selection in **", () => {
    const on = run(toggleMark("**"), "a [bold] word");
    expect(on.text).toBe("a **bold** word");
    expect(on.sel).toEqual([4, 8]);
    expect(run(toggleMark("**"), "a **[bold]** word").text).toBe("a bold word");
    expect(run(toggleMark("**"), "a [**bold**] word").text).toBe("a bold word");
  });

  it("⌘B with nothing selected leaves the cursor between the marks", () => {
    const r = run(toggleMark("**"), "a | word");
    expect(r.text).toBe("a **** word");
    expect(r.sel).toEqual([4, 4]);
  });

  it("⌘B inside a word makes the word bold", () => {
    const r = run(toggleMark("**"), "a wo|rd here");
    expect(r.text).toBe("a **word** here");
    expect(r.sel).toEqual([6, 6]);
  });

  it("⌘B at the end of bold text steps out of it", () => {
    const r = run(toggleMark("**"), "a **bold|** word");
    expect(r.text).toBe("a **bold** word");
    expect(r.sel).toEqual([10, 10]);
  });

  it("⌘K makes a selection a link, the cursor staying in its text", () => {
    const r = run(insertLink, "see [the plan] now");
    expect(r.text).toBe("see [the plan]() now");
    expect(r.sel).toEqual([13, 13]);
    expect(run(insertLink, "no| selection").handled).toBe(false);
  });

  it("⌘⇧8 and ⌘⇧7 make lists, and take lines out of them", () => {
    expect(run(toggleList("bullet"), "[a\nb]").text).toBe("- a\n- b");
    expect(run(toggleList("bullet"), "[- a\n- b]").text).toBe("a\nb");
    expect(run(toggleList("number"), "[a\n- b]").text).toBe("1. a\n2. b");
    expect(run(toggleList("bullet"), "  1. |a").text).toBe("  - a");
  });

  it("ticks and unticks a task box", () => {
    const view = (doc: string) => {
      let state = EditorState.create({ doc });
      return {
        get state() {
          return state;
        },
        dispatch(spec: TransactionSpec) {
          state = state.update(spec).state;
        },
      } as unknown as EditorView;
    };
    const v = view("- [ ] task");
    expect(toggleTask(v, 2)).toBe(true);
    expect(v.state.doc.toString()).toBe("- [x] task");
    toggleTask(v, 2);
    expect(v.state.doc.toString()).toBe("- [ ] task");
    expect(toggleTask(v, 0)).toBe(false);
  });
});
