import { conflictsIn, resolution } from "@anur/core";
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

export type ConflictMark = "open" | "base" | "middle" | "close";

/**
 * A merge-conflict marker drawn as a label (2.19). The opening one offers
 * to keep either side or both, which replaces the whole conflict in the
 * text; the file is the person's to resolve, so nothing happens on its own.
 */
export class ConflictMarkWidget extends WidgetType {
  constructor(
    readonly kind: ConflictMark,
    readonly label: string,
  ) {
    super();
  }
  override eq(other: ConflictMarkWidget) {
    return other.kind === this.kind && other.label === this.label;
  }
  toDOM(view: EditorView) {
    const bar = document.createElement("span");
    bar.className = `cm-lp-conflict-label cm-lp-conflict-label-${this.kind}`;
    const name = document.createElement("span");
    const named = this.label ? ` · ${this.label}` : "";
    name.textContent =
      this.kind === "open"
        ? `Merge conflict: your version${named}`
        : this.kind === "base"
          ? `The original${named}`
          : this.kind === "middle"
            ? "Their version"
            : `End of conflict${named}`;
    bar.append(name);
    if (this.kind === "open" && !view.state.readOnly) {
      for (const [keep, text] of [
        ["ours", "Keep yours"],
        ["theirs", "Keep theirs"],
        ["both", "Keep both"],
      ] as const) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "cm-lp-conflict-keep";
        b.textContent = text;
        b.addEventListener("mousedown", (e) => {
          e.preventDefault();
        });
        b.addEventListener("click", (e) => {
          e.preventDefault();
          keepSide(view, view.posAtDOM(bar), keep);
        });
        bar.append(b);
      }
    }
    return bar;
  }
  override ignoreEvent() {
    return true;
  }
}

function keepSide(view: EditorView, at: number, keep: "ours" | "theirs" | "both") {
  const lineFrom = view.state.doc.lineAt(at).from;
  const c = conflictsIn(view.state.doc.toString()).find((x) => x.from === lineFrom);
  if (!c) return;
  view.dispatch({
    changes: { from: c.from, to: c.to, insert: resolution(c, keep) },
    selection: { anchor: c.from },
    userEvent: "input.resolve",
    scrollIntoView: true,
  });
  view.focus();
}
