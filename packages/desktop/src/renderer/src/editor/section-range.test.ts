import { EditorState, type TransactionSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { bodyRange, putOption, renameSection, sectionNow } from "./section-range.ts";
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

describe("a picked option", () => {
  const page = (doc: string) => {
    let now = state(doc);
    return {
      get state() {
        return now;
      },
      dispatch: (spec: TransactionSpec) => {
        now = now.update(spec).state;
      },
    };
  };
  const doc =
    "# Plan\n\n## Retry\n\nThree tries.\n\n### Payday\n\nOn the 1st.\n\n## Next\n\nLater.\n";
  const option = { title: "Smart retry", text: "Retry when the card is likely to pass." };

  it("replaces the section's own text, keeping its subsections", () => {
    const p = page(doc);
    expect(putOption(p, "doc.md", section(doc, "Retry"), option, "replace")).toBe(true);
    expect(p.state.doc.toString()).toBe(
      doc.replace("Three tries.", "Retry when the card is likely to pass."),
    );
  });

  it("fills an empty section as a paragraph under its heading", () => {
    const empty = "# Plan\n\n## Retry\n\n## Next\n";
    const p = page(empty);
    putOption(p, "doc.md", section(empty, "Retry"), option, "replace");
    expect(p.state.doc.toString()).toBe(
      "# Plan\n\n## Retry\n\nRetry when the card is likely to pass.\n\n## Next\n",
    );
  });

  it("can go in as a subsection, after everything under the section", () => {
    const p = page(doc);
    putOption(p, "doc.md", section(doc, "Retry"), option, "subsection");
    expect(p.state.doc.toString()).toBe(
      doc.replace(
        "On the 1st.\n\n## Next",
        "On the 1st.\n\n### Smart retry\n\nRetry when the card is likely to pass.\n\n## Next",
      ),
    );
  });
});
