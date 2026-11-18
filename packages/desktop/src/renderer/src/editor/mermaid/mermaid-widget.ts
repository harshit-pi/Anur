import { type EditorView, WidgetType } from "@codemirror/view";

/**
 * A ```mermaid block drawn as its diagram while the cursor is elsewhere; a
 * click puts the cursor in its source to edit, as a table's does. Mermaid
 * loads only when a page has a diagram, and draws in the app's theme.
 */

let loaded: Promise<typeof import("mermaid").default> | null = null;
let ids = 0;

function mermaid(dark: boolean) {
  loaded ??= import("mermaid").then((m) => m.default);
  return loaded.then((m) => {
    m.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: dark ? "dark" : "neutral",
      fontFamily: "Avenir Next, Avenir, sans-serif",
    });
    return m;
  });
}

const isDark = () => {
  const forced = document.documentElement.dataset.theme;
  return forced ? forced === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
};

export class MermaidWidget extends WidgetType {
  constructor(
    readonly source: string,
    /** Where the block's source starts, for the cursor on a click. */
    readonly at: number,
  ) {
    super();
  }
  override eq(other: MermaidWidget) {
    return other.source === this.source && other.at === this.at;
  }
  override get estimatedHeight() {
    return 260;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-lp-mermaid";
    wrap.contentEditable = "false";
    wrap.title = "Click to edit the diagram's source";
    wrap.textContent = "Drawing the diagram…";
    wrap.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.at } });
      view.focus();
    });
    const id = `anur-mermaid-${String(++ids)}`;
    void mermaid(isDark())
      .then((m) => m.render(id, this.source))
      .then(({ svg }) => {
        wrap.innerHTML = svg;
        view.requestMeasure();
      })
      .catch((e: unknown) => {
        // The diagram doesn't parse yet: say so, and keep the source a click away.
        document.getElementById(`d${id}`)?.remove();
        wrap.classList.add("cm-lp-mermaid-error");
        const first = (e instanceof Error ? e.message : String(e)).split("\n")[0] ?? "";
        wrap.textContent = `This diagram doesn't draw yet: ${first}`;
        view.requestMeasure();
      });
    return wrap;
  }

  override ignoreEvent() {
    return false;
  }
}
