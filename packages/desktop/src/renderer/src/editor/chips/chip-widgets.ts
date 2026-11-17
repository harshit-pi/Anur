import { syntaxTree } from "@codemirror/language";
import { type EditorView, WidgetType } from "@codemirror/view";
import {
  CALLOUT_KINDS,
  LANGUAGES,
  calloutKindRange,
  capitalised,
  chooseFrom,
  embedPathRange,
  fenceInfoRange,
  languageName,
  replace,
} from "./chips.ts";

/** Keep the editor's cursor and focus where they are when a chip is pressed. */
function chip(view: EditorView, cls: string, label: string, onPress: (dom: HTMLElement) => void) {
  const s = document.createElement("span");
  s.className = `cm-lp-chip ${cls}`;
  s.textContent = label;
  if (!view.state.readOnly) {
    s.setAttribute("role", "button");
    s.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });
    s.addEventListener("click", (e) => {
      e.preventDefault();
      onPress(s);
    });
  }
  return s;
}

/** A callout's "[!note]" as its label; a click picks another type. */
export class CalloutLabelWidget extends WidgetType {
  constructor(readonly kind: string) {
    super();
  }
  override eq(other: CalloutLabelWidget) {
    return other.kind === this.kind;
  }
  toDOM(view: EditorView) {
    const s = chip(
      view,
      `cm-lp-callout-label cm-lp-callout-label-${this.kind}`,
      capitalised(this.kind),
      (dom) => {
        const at = calloutKindRange(view.state, view.posAtDOM(dom));
        if (!at) return;
        const current = at.kind.toLowerCase();
        const kinds: string[] = [...CALLOUT_KINDS];
        if (!kinds.includes(current)) kinds.unshift(current);
        void chooseFrom(
          kinds.map((k) => ({ id: k, label: capitalised(k), checked: k === current })),
        ).then((id) => {
          const now = calloutKindRange(view.state, view.posAtDOM(dom));
          if (id && now) replace(view, now.from, now.to, id);
        });
      },
    );
    s.title = "Change the callout type";
    return s;
  }
  override ignoreEvent() {
    return true;
  }
}

/** A code block's opening fence as its language; a click picks another. */
export class LanguageChipWidget extends WidgetType {
  constructor(readonly info: string) {
    super();
  }
  override eq(other: LanguageChipWidget) {
    return other.info === this.info;
  }
  toDOM(view: EditorView) {
    const s = chip(view, "cm-lp-language", languageName(this.info), (dom) => {
      const at = fenceInfoRange(view.state, view.posAtDOM(dom));
      if (!at) return;
      const current = at.info.toLowerCase();
      const known = LANGUAGES.some(([id]) => id === current);
      const items = [
        ...(known ? [] : [{ id: `lang:${current}`, label: at.info, checked: true }]),
        ...LANGUAGES.map(([id, label]) => ({ id: `lang:${id}`, label, checked: id === current })),
      ];
      void chooseFrom(items).then((id) => {
        const now = fenceInfoRange(view.state, view.posAtDOM(dom));
        if (id && now) replace(view, now.from, now.to, id.slice("lang:".length));
      });
    });
    s.title = "Change the language";
    return s;
  }
  override ignoreEvent() {
    return true;
  }
}

/** An image or embed as a chip naming its path; a click edits the path in a pop-up. */
export class EmbedWidget extends WidgetType {
  constructor(readonly target: string) {
    super();
  }
  override eq(other: EmbedWidget) {
    return other.target === this.target;
  }
  toDOM(view: EditorView) {
    const image = /\.(png|jpe?g|gif|svg|webp|bmp|avif)$|^https?:\/\//i.test(this.target);
    const s = chip(view, "cm-lp-embed", `${image ? "Image" : "Embed"}: ${this.target}`, (dom) => {
      openPathEditor(view, dom);
    });
    s.title = "Change the path";
    return s;
  }
  override ignoreEvent() {
    return true;
  }
}

/** A small pop-up under the chip with the path; Enter writes it, Escape or a click away closes it. */
export function openPathEditor(view: EditorView, dom: HTMLElement) {
  const at = embedPathRange(view.state, view.posAtDOM(dom));
  if (!at) return;
  document.querySelector(".cm-lp-path-editor")?.remove();
  const box = document.createElement("div");
  box.className = "cm-lp-path-editor";
  const input = document.createElement("input");
  input.type = "text";
  input.spellcheck = false;
  input.setAttribute("aria-label", "Path");
  input.value = view.state.sliceDoc(at.from, at.to);
  box.append(input);
  const rect = dom.getBoundingClientRect();
  box.style.left = `${String(rect.left)}px`;
  box.style.top = `${String(rect.bottom + 6)}px`;
  document.body.append(box);
  input.focus();
  input.select();
  let done = false;
  const close = (write: boolean) => {
    if (done) return;
    done = true;
    if (write) {
      const now = embedPathRange(view.state, view.posAtDOM(dom));
      const path = input.value.trim();
      if (now && path) replace(view, now.from, now.to, path);
    }
    box.remove();
    view.focus();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close(false);
    }
  });
  input.addEventListener("blur", () => {
    close(true);
  });
}

const COPY_ICON =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M10.5 5V3.5A1.5 1.5 0 0 0 9 2H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5H5"/></svg>';
const CHECK_ICON =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>';

/** The code inside the fenced block at `pos`, without its fences. */
export function codeAt(view: EditorView, pos: number): string | null {
  for (let n = syntaxTree(view.state).resolveInner(pos, 1); n.parent; n = n.parent) {
    if (n.name !== "FencedCode") continue;
    const doc = view.state.doc;
    const first = doc.lineAt(n.from);
    const last = doc.lineAt(n.to);
    const closed = last.number > first.number && /^\s*(```|~~~)/.test(last.text);
    const to = closed ? last.from - 1 : n.to;
    return first.to < to ? doc.sliceString(first.to + 1, to) : "";
  }
  return null;
}

/** A code block's copy button, at the end of its first line: copies the code alone. */
export class CopyCodeWidget extends WidgetType {
  override eq() {
    return true;
  }
  toDOM(view: EditorView) {
    const b = document.createElement("button");
    b.className = "cm-lp-copy-code";
    b.type = "button";
    b.title = "Copy code";
    b.setAttribute("aria-label", "Copy code");
    b.innerHTML = COPY_ICON;
    let timer: ReturnType<typeof setTimeout> | undefined;
    b.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });
    b.addEventListener("click", (e) => {
      e.preventDefault();
      const code = codeAt(view, view.posAtDOM(b));
      if (code === null) return;
      void import("../../bridge.ts")
        .then(({ anur }) => anur.call("clipboard:write", { text: code }))
        .then(() => {
          b.innerHTML = CHECK_ICON;
          b.title = "Copied";
          clearTimeout(timer);
          timer = setTimeout(() => {
            b.innerHTML = COPY_ICON;
            b.title = "Copy code";
          }, 1500);
        });
    });
    return b;
  }
  override ignoreEvent() {
    return true;
  }
}
