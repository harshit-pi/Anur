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
    const image = /\.(png|jpe?g|gif|svg|webp)$/i.test(this.target);
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
function openPathEditor(view: EditorView, dom: HTMLElement) {
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
