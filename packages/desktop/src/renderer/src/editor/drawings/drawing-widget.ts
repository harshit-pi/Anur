import { type EditorView, WidgetType } from "@codemirror/view";
import { pagePath } from "../bases/base-widget.ts";

import "./assets.ts";
/**
 * An embedded Excalidraw drawing, `![[Flow.excalidraw]]`, drawn as the
 * picture itself. A click opens it in its own tab, full size and editable
 * (⌘-click: a new tab). It draws again when the window comes back, so edits
 * made there or in Obsidian show.
 */

const isDark = () => {
  const forced = document.documentElement.dataset.theme;
  return forced ? forced === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
};

export class DrawingWidget extends WidgetType {
  constructor(readonly target: string) {
    super();
  }
  override eq(other: DrawingWidget) {
    return other.target === this.target;
  }
  override get estimatedHeight() {
    return 320;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-lp-drawing";
    wrap.contentEditable = "false";
    wrap.title = "Open the drawing to edit it (⌘-click: in a new tab)";
    wrap.textContent = `Drawing ${this.target}…`;
    let path: string | null = null;
    wrap.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (path)
        window.dispatchEvent(
          new CustomEvent("anur:open-path", { detail: { path, newTab: e.metaKey || e.ctrlKey } }),
        );
    });
    const draw = () => {
      void (async () => {
        const { anur } = await import("../../bridge.ts");
        const r = await anur.call("drawing:read", {
          target: this.target,
          from: view.state.facet(pagePath),
        });
        if (r.kind !== "drawing") {
          wrap.textContent = r.reason;
          wrap.classList.add("missing");
          return;
        }
        path = r.path;
        const scene = JSON.parse(r.scene) as {
          elements?: unknown[];
          appState?: Record<string, unknown>;
          files?: unknown;
        };
        // Excalidraw's own types don't resolve here: the one call used, typed.
        const { exportToSvg } = (await import("@excalidraw/excalidraw")) as unknown as {
          exportToSvg: (opts: Record<string, unknown>) => Promise<SVGSVGElement>;
        };
        const svg = await exportToSvg({
          elements: scene.elements ?? [],
          appState: {
            ...(scene.appState ?? {}),
            exportBackground: false,
            exportWithDarkMode: isDark(),
          },
          files: scene.files ?? {},
          exportPadding: 16,
        });
        svg.removeAttribute("width");
        svg.removeAttribute("height");
        wrap.replaceChildren(svg);
        wrap.classList.remove("missing");
        view.requestMeasure();
      })().catch(() => {
        wrap.textContent = `${this.target} couldn't be drawn.`;
        wrap.classList.add("missing");
      });
    };
    window.addEventListener("focus", draw);
    draw();
    return wrap;
  }

  override ignoreEvent() {
    return false;
  }
}
