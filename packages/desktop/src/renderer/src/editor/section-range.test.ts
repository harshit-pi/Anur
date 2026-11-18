import { EditorState, type TransactionSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { bodyRange, renameSection, sectionNow } from "./section-range.ts";
import { markdownSupport, sectionsOf } from "./sections.ts";

const state = (doc: string) => EditorState.create({ doc, extensions: [markdownSupport()] });
const section = (doc: string, name: string) => {
  const s = sectionsOf(state(doc), "doc.md").sections.find((x) => x.path.at(-1) === name);
  if (!s) throw new Error(name);
  return s;
};
const body = (doc: string, name: string) => {
  const r = bodyRange(state(doc), "doc.md", section(doc, name));
  return r && doc.slice(r.from, r.to);
};

describe("a section's text, as Think's editor holds it", () => {
  it("leaves out the heading and the blank lines around the text", () => {
    const doc = "# Plan\n\n## Retry\n\nThree tries.\nThen stop.\n\n## Next\n";
    expect(body(doc, "Retry")).toBe("Three tries.\nThen stop.");
  });

  it("keeps a space typed at the end, so Backspace can take it", () => {
    const doc = "# Plan\n\n## Retry\n\nThree tries. \n\n## Next\n";
    expect(body(doc, "Retry")).toBe("Three tries. ");
  });

  it("is empty, right after the heading, when the section has no text", () => {
    const doc = "# Plan\n\n## Retry\n\n## Next\n";
    const r = bodyRange(state(doc), "doc.md", section(doc, "Retry"));
    expect(r).toEqual({ from: doc.indexOf("## Retry") + 8, to: doc.indexOf("## Retry") + 8 });
  });
});

describe("renaming a section", () => {
  it("changes only the heading's words, never its level or closing marks", () => {
    const doc = "# Plan\n\n### Retry ##\n\nThree tries.\n";
    // The page, as far as a rename needs it.
    let now = state(doc);
    const view = {
      get state() {
        return now;
      },
      dispatch: (spec: TransactionSpec) => {
        now = now.update(spec).state;
      },
    };
    expect(renameSection(view, "doc.md", section(doc, "Retry"), "Retry timing")).toBe(true);
    expect(view.state.doc.toString()).toBe("# Plan\n\n### Retry timing ##\n\nThree tries.\n");
    expect(
      sectionNow(view.state, "doc.md", section(view.state.doc.toString(), "Retry timing")),
    ).not.toBeNull();
  });
});
