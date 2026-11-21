import { type EditorView, WidgetType } from "@codemirror/view";
import { pagePath } from "../bases/base-widget.ts";

import "./assets.ts";
import { anur } from "../../bridge.ts";
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

/**
 * Pictures already drawn, while Anur runs: by the page and the embed, the
 * last picture (shown at once when the page comes back) and the scene it
 * drew, so an unchanged drawing is never drawn again.
 */
const drawn = new Map<string, { scene: string; dark: boolean; svg: string }>();

/** Each drawn picture's focus listener, removed when it leaves the page. */
const listeners = new WeakMap<HTMLElement, () => void>();

/** Excalidraw loaded ahead, while Anur is idle, so the first drawing doesn't wait for it. */
export function loadAhead() {
  void import("@excalidraw/excalidraw").catch(() => undefined);
}

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
    const key = `${view.state.facet(pagePath)}\0${this.target}`;
    const kept = drawn.get(key);
    if (kept) wrap.innerHTML = kept.svg;
    wrap.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (path)
        window.dispatchEvent(
          new CustomEvent("anur:open-path", { detail: { path, newTab: e.metaKey || e.ctrlKey } }),
        );
    });
    const draw = () => {
      void (async () => {
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
        const dark = isDark();
        const before = drawn.get(key);
        // Unchanged since it was last drawn: the picture already shown stands.
        if (before && before.scene === r.scene && before.dark === dark) {
          if (!wrap.firstElementChild) wrap.innerHTML = before.svg;
          return;
        }
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
            exportWithDarkMode: dark,
          },
          files: scene.files ?? {},
          exportPadding: 16,
        });
        svg.removeAttribute("width");
        svg.removeAttribute("height");
        wrap.replaceChildren(svg);
        drawn.set(key, { scene: r.scene, dark, svg: svg.outerHTML });
        wrap.classList.remove("missing");
        view.requestMeasure();
      })().catch(() => {
        wrap.textContent = `${this.target} couldn't be drawn.`;
        wrap.classList.add("missing");
      });
    };
    // Back to the window: drawn again, at most every few seconds, and only while on the page.
    let last = 0;
    const again = () => {
      if (!wrap.isConnected || Date.now() - last < 5000) return;
      last = Date.now();
      draw();
    };
    window.addEventListener("focus", again);
    listeners.set(wrap, again);
    last = Date.now();
    draw();
    return wrap;
  }

  override destroy(dom: HTMLElement) {
    const on = listeners.get(dom);
    if (on) window.removeEventListener("focus", on);
  }

  override ignoreEvent() {
    return false;
  }
}
