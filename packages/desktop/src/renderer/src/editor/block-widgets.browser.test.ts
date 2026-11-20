import { cursorLineDown, cursorLineUp } from "@codemirror/commands";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { beforeAll, describe, expect, it } from "vitest";

/** A doc with every kind of block widget between plain lines. */
const DOC = `---
owner: [a]
---

# Doc

Line 1

![](a.png)

Line 2

| A | B |
|---|---|
| 1 | 2 |

Line 3

\`\`\`mermaid
graph TD; A-->B
\`\`\`

Line 4

![[sketch.excalidraw]]

Line 5

![[list.base]]

Line 6
`;

/** A doc with a thread's proposal shown under its middle section. */
const PROPOSED = `# Plan

Line 1

## Risks

Line 2

The host is untested.

## Budget

Line 3
`;

let page: EditorView;
let proposal: EditorView;

async function mount(doc: string, extra: Extension[] = []): Promise<EditorView> {
  const { livePreview } = await import("./live-preview/live-preview.ts");
  const { livePreviewTheme } = await import("./live-preview/style.ts");
  const { markdownSupport } = await import("./sections.ts");
  const { pageTheme } = await import("./theme.ts");
  const { pagePath } = await import("./bases/base-widget.ts");
  const parent = document.createElement("div");
  parent.style.width = "700px";
  document.body.append(parent);
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        EditorView.lineWrapping,
        pageTheme,
        markdownSupport(),
        livePreview,
        livePreviewTheme,
        pagePath.of("doc.md"),
        ...extra,
      ],
    }),
  });
}

beforeAll(async () => {
  // The widgets ask the app for their content; here nothing ever answers.
  (window as unknown as { anur: unknown }).anur = {
    call: () => new Promise(() => undefined),
    on: () => () => undefined,
  };
  page = await mount(DOC);
  const { previewExtension, setPreviews } = await import("./previews/preview-widget.ts");
  proposal = await mount(PROPOSED, [previewExtension]);
  const base = "## Risks\n\nLine 2\n\nThe host is untested.\n";
  proposal.dispatch({
    effects: setPreviews.of([
      {
        thread: "t1",
        title: "Tighten the risk",
        parts: [
          {
            section: null,
            path: ["Plan", "Risks"],
            base,
            proposed: base.replace("untested", "tested on Linux"),
          },
        ],
      },
    ]),
  });
  await new Promise((r) => setTimeout(r, 300));
});

/** The plain lines the cursor visits, moving from one end of the doc to the other. */
function visits(view: EditorView, down: boolean): string[] {
  view.dispatch({ selection: EditorSelection.cursor(down ? 0 : view.state.doc.length) });
  const seen: string[] = [];
  for (let i = 0; i < 60; i++) {
    (down ? cursorLineDown : cursorLineUp)(view);
    const text = view.state.doc.lineAt(view.state.selection.main.head).text;
    if (/^Line \d$/.test(text) && seen.at(-1) !== text) seen.push(text);
  }
  return seen;
}

/** Block widgets with a vertical margin, which CodeMirror's line positions leave out. */
function withMargin(view: EditorView) {
  return [...view.contentDOM.children]
    .filter((el) => !el.classList.contains("cm-line") && !el.classList.contains("cm-widgetBuffer"))
    .map((el) => {
      const s = getComputedStyle(el);
      return { cls: el.className, top: s.marginTop, bottom: s.marginBottom };
    })
    .filter((b) => b.top !== "0px" || b.bottom !== "0px");
}

describe("block widgets in the page", () => {
  it("draws every kind", () => {
    const kinds = ["properties", "image", "table-wrap", "mermaid", "drawing", "base"];
    for (const k of kinds) expect(page.contentDOM.querySelector(`.cm-lp-${k}`), k).not.toBeNull();
    for (const cls of ["cm-preview-tabs", "cm-preview"])
      expect(proposal.contentDOM.querySelector(`.${cls}`), cls).not.toBeNull();
  });

  it("have no vertical margin", () => {
    expect(withMargin(page)).toEqual([]);
    expect(withMargin(proposal)).toEqual([]);
  });

  it("let Down and Up move one line at a time past them", () => {
    const lines = ["Line 1", "Line 2", "Line 3", "Line 4", "Line 5", "Line 6"];
    expect(visits(page, true)).toEqual(lines);
    expect(visits(page, false)).toEqual([...lines].reverse());
    expect(visits(proposal, true)).toEqual(["Line 1", "Line 3"]);
    expect(visits(proposal, false)).toEqual(["Line 3", "Line 1"]);
  });
});
