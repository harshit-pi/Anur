import { type EditorView, WidgetType } from "@codemirror/view";
import { toggleTask } from "../commands.ts";

/**
 * What live preview draws in place of Markdown source. Widgets only show the
 * text; the document underneath is unchanged, and a click puts the cursor
 * into the source so it can be read and, later, edited.
 */

/** A list's "-" drawn as a bullet. */
export class BulletWidget extends WidgetType {
  override eq() {
    return true;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-lp-bullet";
    s.textContent = "•";
    return s;
  }
}

/** A task's "[ ]" or "[x]" drawn as a checkbox; a click ticks it in the text (2.8). */
export class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  override eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.checked;
    box.tabIndex = -1;
    box.className = "cm-lp-check";
    box.setAttribute("aria-label", this.checked ? "Done" : "Not done");
    // Keep the editor's focus and cursor where they are.
    box.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });
    box.addEventListener("click", (e) => {
      e.preventDefault();
      if (view.state.readOnly) return;
      toggleTask(view, view.posAtDOM(box));
    });
    return box;
  }
}

/** A separator, such as "›" between a wiki link's file and heading. */
export class TextWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly cls: string,
  ) {
    super();
  }
  override eq(other: TextWidget) {
    return other.text === this.text && other.cls === this.cls;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = this.cls;
    s.textContent = this.text;
    return s;
  }
}

/** A horizontal rule drawn as a line. */
export class RuleWidget extends WidgetType {
  override eq() {
    return true;
  }
  toDOM() {
    const hr = document.createElement("span");
    hr.className = "cm-lp-hr";
    return hr;
  }
}
