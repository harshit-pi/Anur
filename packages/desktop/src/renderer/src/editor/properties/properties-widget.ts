import { redo, undo } from "@codemirror/commands";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { type EditorView, WidgetType } from "@codemirror/view";
import { followLinkIn } from "../link-click.ts";
import { renderInline } from "../live-preview/inline.ts";
import { nameOfHandle, ownerChoices } from "../../layout/people.ts";
import {
  type Field,
  type Properties,
  addField,
  frontmatter,
  removeField,
  setKey,
  setValue,
  valueText,
} from "./properties-model.ts";

/**
 * The Properties box, edited in place (task 2.13). Each field's name and
 * value are typed into directly; a list's items are separated by commas
 * while typing and shown as chips otherwise. Every edit rewrites the
 * frontmatter as one editor transaction, so Undo and autosave work as for
 * any other edit, and fields nobody changed keep their lines as written.
 */

function frontmatterRange(state: EditorState): { from: number; to: number } | null {
  const tree = ensureSyntaxTree(state, Math.min(state.doc.length, 4000), 200) ?? syntaxTree(state);
  for (let n = tree.resolveInner(0, 1); n.parent; n = n.parent) {
    if (n.name === "Frontmatter") return { from: n.from, to: n.to };
  }
  return null;
}

type Live = { props: Properties; view: EditorView; drawn: number };

/**
 * Whether the Properties box is folded away: one choice for every doc and
 * folder, kept in Anur's own storage on this device, like panel widths.
 */
const COLLAPSED_KEY = "anur.propertiesCollapsed";

export function isCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

export function setCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, String(collapsed));
  } catch {
    // Storage blocked: the box still folds, until the doc reopens.
  }
  for (const box of document.querySelectorAll<HTMLElement>(".cm-lp-properties")) {
    box.classList.toggle("collapsed", collapsed);
    box.querySelector(".cm-lp-properties-title")?.setAttribute("aria-expanded", String(!collapsed));
  }
}
const live = new WeakMap<HTMLElement, Live>();
let pendingFocus: { row: number; field: "key" | "value"; select: boolean } | null = null;

const cellOf = (box: HTMLElement, row: number, field: "key" | "value") =>
  box.querySelector<HTMLElement>(`[data-row="${String(row)}"][data-field="${field}"]`);

function focusCell(cell: HTMLElement, select = false) {
  cell.focus();
  const range = document.createRange();
  range.selectNodeContents(cell);
  if (!select) range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/** A value as read: chips for a list, or for tags; rendered Markdown for a text. */
function showValue(cell: HTMLElement, f: Field) {
  cell.replaceChildren();
  const chips = f.kind === "inline-list" || f.kind === "block-list" || f.key === "tags";
  if (f.values.length === 0) {
    cell.classList.add("cm-lp-property-empty");
    return;
  }
  cell.classList.remove("cm-lp-property-empty");
  f.values.forEach((v, i) => {
    if (chips && f.key === "owner") {
      // An owner is stored by handle and shown by name (people).
      const chip = document.createElement("span");
      chip.className = "cm-lp-tag";
      chip.dataset.owner = v;
      chip.textContent = nameOfHandle(v);
      if (chip.textContent !== v) chip.title = v;
      cell.append(chip);
    } else if (chips) {
      const chip = document.createElement("span");
      chip.className = "cm-lp-tag";
      chip.append(renderInline(v));
      cell.append(chip);
    } else {
      cell.append(renderInline(v));
      if (i < f.values.length - 1) cell.append(", ");
    }
  });
}

export class PropertiesWidget extends WidgetType {
  constructor(readonly props: Properties) {
    super();
  }

  override eq(other: PropertiesWidget) {
    return frontmatter(other.props) === frontmatter(this.props);
  }

  toDOM(view: EditorView) {
    const editable = !view.state.readOnly;
    const box = document.createElement("div");
    box.className = "cm-lp-properties";
    box.contentEditable = "false";
    // A press on the title folds the box away; the choice holds for every doc.
    const title = document.createElement("button");
    title.type = "button";
    title.className = "cm-lp-properties-title";
    const caret = document.createElement("span");
    caret.className = "cm-lp-properties-caret";
    caret.setAttribute("aria-hidden", "true");
    const count = document.createElement("span");
    count.className = "cm-lp-properties-count";
    count.textContent = String(this.props.fields.length);
    title.append(caret, "Properties", count);
    title.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });
    title.addEventListener("click", () => {
      setCollapsed(!isCollapsed());
    });
    box.append(title);
    box.classList.toggle("collapsed", isCollapsed());
    title.setAttribute("aria-expanded", String(!isCollapsed()));
    this.props.fields.forEach((f, row) => {
      const line = document.createElement("div");
      line.className = "cm-lp-property";
      const key = document.createElement("span");
      key.className = "cm-lp-property-key";
      key.dataset.row = String(row);
      key.dataset.field = "key";
      key.textContent = f.key;
      const value = document.createElement("span");
      value.className = "cm-lp-property-value";
      value.dataset.row = String(row);
      value.dataset.field = "value";
      value.dataset.placeholder = f.kind === "empty" ? "Empty" : "";
      if (editable) {
        key.contentEditable = "plaintext-only";
        value.contentEditable = "plaintext-only";
        key.spellcheck = false;
      }
      showValue(value, f);
      line.append(key, value);
      if (editable) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "cm-lp-property-remove";
        // The same cross as elsewhere in the app, drawn rather than typed.
        remove.innerHTML =
          '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M4.75 4.75l6.5 6.5M11.25 4.75l-6.5 6.5"/></svg>';
        remove.setAttribute("aria-label", `Remove ${f.key}`);
        remove.title = `Remove ${f.key}`;
        remove.dataset.remove = String(row);
        line.append(remove);
      }
      box.append(line);
    });
    if (editable) {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "cm-lp-property-add";
      add.textContent = "+ Add property";
      box.append(add);
    }
    live.set(box, { props: this.props, view, drawn: this.props.fields.length });
    if (editable) wire(box);

    const pending = pendingFocus;
    if (pending) {
      requestAnimationFrame(() => {
        if (pendingFocus !== pending || !box.isConnected) return;
        pendingFocus = null;
        const cell = cellOf(box, pending.row, pending.field);
        if (cell) focusCell(cell, pending.select);
      });
    }
    return box;
  }

  /** Same fields: patch in place, so the one being typed in keeps its caret. */
  override updateDOM(dom: HTMLElement, view: EditorView) {
    const state = live.get(dom);
    if (!state || state.drawn !== this.props.fields.length) return false;
    state.props = this.props;
    state.view = view;
    const count = dom.querySelector(".cm-lp-properties-count");
    if (count) count.textContent = String(this.props.fields.length);
    this.props.fields.forEach((f, row) => {
      const key = cellOf(dom, row, "key");
      const value = cellOf(dom, row, "value");
      if (key && key !== document.activeElement && key.textContent !== f.key) {
        key.textContent = f.key;
      }
      if (value && value !== document.activeElement) showValue(value, f);
      else if (value && value.innerText.trim() !== valueText(f)) {
        value.textContent = valueText(f);
        focusCell(value);
      }
    });
    return true;
  }

  override ignoreEvent() {
    return true;
  }
}

function commit(box: HTMLElement, next: Properties, userEvent: string) {
  const state = live.get(box);
  if (!state) return;
  const range = frontmatterRange(state.view.state);
  if (!range) return;
  state.props = next;
  state.view.dispatch({
    changes: { from: range.from, to: range.to, insert: frontmatter(next) },
    userEvent,
  });
}

function wire(box: HTMLElement) {
  const current = () => live.get(box)?.props;
  const where = (cell: HTMLElement) => ({
    row: Number(cell.dataset.row),
    field: cell.dataset.field as "key" | "value",
  });

  box.addEventListener("focusin", (e) => {
    const cell = e.target as HTMLElement;
    if (cell.dataset.field !== "value") return;
    const f = current()?.fields[Number(cell.dataset.row)];
    // While typed in, a list is its items separated by commas.
    cell.textContent = f ? valueText(f) : "";
    if (f?.key === "owner") suggestOwners(cell, f.values);
    requestAnimationFrame(() => {
      if (document.activeElement === cell) focusCell(cell);
    });
  });

  box.addEventListener("focusout", (e) => {
    const cell = e.target as HTMLElement;
    const p = current();
    if (!cell.dataset.field || !p) return;
    const { row, field } = where(cell);
    const f = p.fields[row];
    if (!f) return;
    if (field === "value") {
      showValue(cell, f);
      cell.parentElement?.querySelector(".cm-lp-owner-suggest")?.remove();
    }
    // A name can't be empty: an emptied one goes back to what it was.
    else if (cell.innerText.trim() === "") cell.textContent = f.key;
  });

  box.addEventListener("input", (e) => {
    const cell = e.target as HTMLElement;
    const p = current();
    if (!cell.dataset.field || !p || (e instanceof InputEvent && e.isComposing)) return;
    const { row, field } = where(cell);
    const typed = cell.innerText;
    const next = field === "key" ? setKey(p, row, typed) : setValue(p, row, typed);
    if (next !== p) commit(box, next, "input.type");
  });

  box.addEventListener("compositionend", (e) => {
    (e.target as HTMLElement).dispatchEvent(new InputEvent("input", { bubbles: true }));
  });

  box.addEventListener("keydown", (e) => {
    const cell = e.target as HTMLElement;
    const p = current();
    const view = live.get(box)?.view;
    if (!cell.dataset.field || !p || !view || e.isComposing) return;
    const { row, field } = where(cell);
    const last = p.fields.length - 1;
    const go = (r: number, f: "key" | "value") => {
      const target = cellOf(box, r, f);
      if (target) focusCell(target);
    };
    const mod = e.metaKey || e.ctrlKey;
    let handled = true;
    if (e.key === "Tab" && !e.shiftKey) {
      if (field === "key") go(row, "value");
      else if (row < last) go(row + 1, "key");
      else handled = false;
    } else if (e.key === "Tab") {
      if (field === "value") go(row, "key");
      else if (row > 0) go(row - 1, "value");
      else handled = false;
    } else if (e.key === "Enter") {
      if (row < last) go(row + 1, field);
      else {
        pendingFocus = { row: row + 1, field: "key", select: true };
        commit(box, addField(p), "input.properties");
      }
    } else if (e.key === "ArrowUp" && !mod && row > 0) {
      go(row - 1, field);
    } else if (e.key === "ArrowDown" && !mod && row < last) {
      go(row + 1, field);
    } else if (e.key === "Escape" || (e.key === "ArrowDown" && row === last)) {
      const range = frontmatterRange(view.state);
      view.focus();
      if (range) {
        view.dispatch({ selection: { anchor: Math.min(view.state.doc.length, range.to + 1) } });
      }
    } else if (mod && e.key.toLowerCase() === "z") {
      (e.shiftKey ? redo : undo)(view);
    } else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  box.addEventListener("mousedown", (e) => {
    if ((e.target as HTMLElement).tagName === "BUTTON") {
      e.preventDefault();
      return;
    }
    // A link in a value that isn't being edited is followed, not typed into.
    const view = live.get(box)?.view;
    const cell = (e.target as HTMLElement).closest<HTMLElement>("[data-field]");
    if (view) followLinkIn(view, e, cell);
  });

  box.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const p = current();
    if (!p || target.tagName !== "BUTTON") return;
    if (target.dataset.remove !== undefined) {
      commit(box, removeField(p, Number(target.dataset.remove)), "delete.properties");
    } else if (target.classList.contains("cm-lp-property-add")) {
      pendingFocus = { row: p.fields.length, field: "key", select: true };
      commit(box, addField(p), "input.properties");
    }
  });
}

/**
 * While an owner list is typed in: the folder's other people, by name, to add
 * with a click; each goes in by handle, as the list stores it (people).
 */
function suggestOwners(cell: HTMLElement, have: readonly string[]) {
  const line = cell.parentElement;
  if (!line) return;
  line.querySelector(".cm-lp-owner-suggest")?.remove();
  const choices = ownerChoices().filter((c) => !have.includes(c.value));
  if (choices.length === 0) return;
  const strip = document.createElement("div");
  strip.className = "cm-lp-owner-suggest";
  for (const c of choices) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cm-lp-tag";
    b.textContent = `+ ${c.name}`;
    b.title = c.value;
    // Pressed before the cell loses focus, so the typing it adds to is still there.
    b.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const typed = cell.innerText.trim();
      cell.textContent = typed ? `${typed}, ${c.value}` : c.value;
      cell.dispatchEvent(new InputEvent("input", { bubbles: true }));
      b.remove();
    });
    strip.append(b);
  }
  line.append(strip);
}
