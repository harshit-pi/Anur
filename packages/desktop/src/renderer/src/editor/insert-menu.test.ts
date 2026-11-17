import { CompletionContext, type Completion } from "@codemirror/autocomplete";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { docLinks, folderDocs, slashMenu } from "./insert-menu.ts";

const stateAt = (doc: string, docs: string[] = []) =>
  EditorState.create({ doc, selection: { anchor: doc.length }, extensions: folderDocs.of(docs) });

const opens = (doc: string) => slashMenu(new CompletionContext(stateAt(doc), doc.length, false));

/** Pick `label` from the menu opened at the end of `before`, with `after` following. */
function pick(before: string, label: string, after = "") {
  let state = EditorState.create({
    doc: before + after,
    selection: { anchor: before.length },
  });
  const result = slashMenu(new CompletionContext(state, before.length, false));
  if (!result) throw new Error("menu didn't open");
  const item = result.options.find((o) => o.label === label);
  const view = {
    get state() {
      return state;
    },
    dispatch(spec: TransactionSpec) {
      state = state.update(spec).state;
    },
  } as unknown as EditorView;
  (item?.apply as (v: EditorView, c: Completion, from: number, to: number) => void)(
    view,
    item as Completion,
    result.from,
    before.length,
  );
  return { text: state.doc.toString(), cursor: state.selection.main.head };
}

describe("the / menu", () => {
  it("opens at the start of a line or after a space", () => {
    expect(opens("/")?.from).toBe(1);
    expect(opens("Some text /ta")?.from).toBe(11);
    expect(opens("line\n/h")?.from).toBe(6);
  });

  it("doesn't open inside a path, a date or a URL", () => {
    expect(opens("a/b")).toBeNull();
    expect(opens("1/2")).toBeNull();
    expect(opens("see https://x.com/a")).toBeNull();
    expect(opens("a / b")).toBeNull();
  });

  it("inserts a 3 × 3 table on its own lines, with a blank line around it", () => {
    const r = pick("Intro\n/tab", "Table", "\nNext");
    expect(r.text).toBe(
      "Intro\n\n| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n\nNext",
    );
  });

  it("keeps the text before the / when inserting a block", () => {
    const r = pick("Before /div", "Divider");
    expect(r.text).toBe("Before\n\n---");
  });

  it("turns the line into a heading or list, without the /", () => {
    expect(pick("Some text /h2", "Heading 2").text).toBe("## Some text");
    expect(pick("## Title /bo", "Body text").text).toBe("Title");
    expect(pick("/task", "Task list").text).toBe("- [ ] ");
    expect(pick("Careful /warn", "Callout: warning").text).toBe("> [!warning] Careful");
  });

  it("puts the cursor inside a new code block", () => {
    const r = pick("/code", "Code block");
    expect(r.text).toBe("```\n\n```");
    expect(r.cursor).toBe(4);
  });
});

describe("[[ links", () => {
  it("offers the folder's docs by name", () => {
    const doc = "See [[Ret";
    const state = stateAt(doc, ["Product/Retry.md", "Personas.md"]);
    const r = docLinks(new CompletionContext(state, doc.length, false));
    expect(r?.from).toBe(6);
    expect(r?.options.map((o) => [o.label, o.detail])).toEqual([
      ["Retry", "Product"],
      ["Personas", undefined],
    ]);
  });
});
