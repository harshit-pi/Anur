import { redo, undo } from "@codemirror/commands";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { type EditorView, WidgetType } from "@codemirror/view";
import { renderInline } from "../live-preview/inline.ts";
import {
  type Align,
  type Table,
  cellRaw,
  cellText,
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  serializeTable,
  setAlign,
  setCell,
  width,
} from "./table-model.ts";

/**
 * A table edited in place (task 2.9). Each cell is typed into directly, as
 * plain text, and every edit rewrites only that table's Markdown as an
 * editor transaction, so Undo, autosave and the file all stay as they are
 * for any other edit. A cell shows its Markdown only while it has focus.
 */

/** Where a table sits in the doc, found from the editor's own parse. */
export function tableRange(state: EditorState, from: number): { from: number; to: number } | null {
  const tree = ensureSyntaxTree(state, from + 1, 200) ?? syntaxTree(state);
  for (let node = tree.resolveInner(from, 1); node.parent; node = node.parent) {
    if (node.name === "Table") return node.from === from ? { from, to: node.to } : null;
  }
  return null;
}

/** The table handlers edit, and the shape the DOM was drawn with, which can lag it. */
type Live = { table: Table; view: EditorView; drawn: { rows: number; cols: number } };
/** The table each widget's DOM shows now; handlers read it at event time. */
const live = new WeakMap<HTMLElement, Live>();

/** The cell to focus once a rebuilt table is drawn, after a row or column is added. */
let pendingFocus: { from: number; row: number; col: number } | null = null;

/** Focus a cell of the table that starts at `from` once it is drawn, as after inserting one. */
export function focusTableWhenDrawn(from: number, row = 0, col = 0) {
  pendingFocus = { from, row, col };
}

const cellsOf = (wrap: HTMLElement) => [...wrap.querySelectorAll<HTMLElement>("[data-row]")];

const cellAt = (wrap: HTMLElement, row: number, col: number) =>
  wrap.querySelector<HTMLElement>(`[data-row="${String(row)}"][data-col="${String(col)}"]`);

const position = (cell: HTMLElement) => ({
  row: Number(cell.dataset.row),
  col: Number(cell.dataset.col),
});

function focusCell(cell: HTMLElement, at: "start" | "end" = "end") {
  cell.focus();
  const range = document.createRange();
  range.selectNodeContents(cell);
  range.collapse(at === "start");
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/** Draw a cell's Markdown rendered, as it reads when not being typed in. */
function showRendered(cell: HTMLElement, raw: string) {
  cell.dataset.raw = raw;
  cell.replaceChildren(renderInline(raw));
}

export class TableWidget extends WidgetType {
  constructor(readonly table: Table) {
    super();
  }

  override eq(other: TableWidget) {
    return serializeTable(other.table) === serializeTable(this.table);
  }

  get header() {
    return this.table.rows[0]?.cells ?? [];
  }

  get rows() {
    return this.table.rows.slice(1).map((r) => r.cells);
  }

  get align() {
    return this.table.align;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-lp-table-wrap";
    wrap.contentEditable = "false";
    const table = document.createElement("table");
    table.className = "cm-lp-table";
    this.table.rows.forEach((row, r) => {
      const tr = document.createElement("tr");
      row.cells.forEach((raw, c) => {
        const cell = document.createElement(r === 0 ? "th" : "td");
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);
        cell.contentEditable = view.state.readOnly ? "false" : "plaintext-only";
        cell.spellcheck = true;
        const a = this.table.align[c];
        if (a) cell.style.textAlign = a;
        showRendered(cell, raw);
        tr.append(cell);
      });
      (r === 0 ? table.createTHead() : (table.tBodies[0] ?? table.createTBody())).append(tr);
    });
    const addRow = document.createElement("button");
    addRow.type = "button";
    addRow.className = "cm-lp-add cm-lp-add-row";
    addRow.textContent = "+";
    addRow.title = "Add a row below";
    addRow.hidden = true;
    const addCol = document.createElement("button");
    addCol.type = "button";
    addCol.className = "cm-lp-add cm-lp-add-col";
    addCol.textContent = "+";
    addCol.title = "Add a column to the right";
    addCol.hidden = true;
    wrap.append(table, addRow, addCol);
    live.set(wrap, {
      table: this.table,
      view,
      drawn: { rows: this.table.rows.length, cols: width(this.table) },
    });
    if (!view.state.readOnly) wire(wrap, view, addRow, addCol);

    const pending = pendingFocus;
    if (pending) {
      requestAnimationFrame(() => {
        if (pendingFocus !== pending || !wrap.isConnected) return;
        if (view.posAtDOM(wrap) !== pending.from) return;
        pendingFocus = null;
        const cell = cellAt(wrap, pending.row, pending.col);
        if (cell) focusCell(cell);
      });
    }
    return wrap;
  }

  /** Same rows and columns: patch the cells in place, so the cell being typed in keeps its caret. */
  override updateDOM(dom: HTMLElement, view: EditorView) {
    const state = live.get(dom);
    if (!state) return false;
    const sameShape =
      state.drawn.rows === this.table.rows.length && state.drawn.cols === width(this.table);
    if (!sameShape) return false;
    state.table = this.table;
    state.view = view;
    for (const cell of cellsOf(dom)) {
      const { row, col } = position(cell);
      const raw = this.table.rows[row]?.cells[col] ?? "";
      const a = this.table.align[col];
      cell.style.textAlign = a ?? "";
      if (cell === document.activeElement) {
        if (cellRaw(cell.innerText) !== raw) {
          cell.textContent = cellText(raw);
          focusCell(cell);
        }
      } else if (cell.dataset.raw !== raw) showRendered(cell, raw);
    }
    return true;
  }

  override ignoreEvent() {
    return true;
  }
}

/** Write a changed table into the doc as one transaction. */
function commit(
  wrap: HTMLElement,
  next: Table,
  userEvent: string,
  focus?: { row: number; col: number },
) {
  const state = live.get(wrap);
  if (!state) return;
  const { view } = state;
  const range = tableRange(view.state, view.posAtDOM(wrap));
  if (!range) return;
  state.table = next;
  if (focus) pendingFocus = { from: range.from, ...focus };
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: serializeTable(next) },
    userEvent,
  });
  // Same shape: the DOM was patched in place, so focus the cell now.
  if (focus && wrap.isConnected) {
    const cell = cellAt(wrap, focus.row, focus.col);
    if (cell) {
      pendingFocus = null;
      focusCell(cell);
    }
  }
}

/** Put the page's cursor just before or after the table, and give it focus. */
function leave(wrap: HTMLElement, where: "before" | "after") {
  const state = live.get(wrap);
  if (!state) return;
  const { view } = state;
  const range = tableRange(view.state, view.posAtDOM(wrap));
  if (!range) return;
  const doc = view.state.doc;
  const anchor =
    where === "before" ? Math.max(0, range.from - 1) : Math.min(doc.length, range.to + 1);
  view.focus();
  view.dispatch({ selection: { anchor }, scrollIntoView: true });
}

type Action =
  | "row-above"
  | "row-below"
  | "col-left"
  | "col-right"
  | "align-left"
  | "align-center"
  | "align-right"
  | "delete-row"
  | "delete-col"
  | "delete-table";

function apply(wrap: HTMLElement, action: Action, row: number, col: number) {
  const state = live.get(wrap);
  if (!state) return;
  const t = state.table;
  const aligned = (a: Align) => {
    commit(wrap, setAlign(t, col, a), "input.table");
  };
  switch (action) {
    case "row-above":
      commit(wrap, insertRow(t, row), "input.table", { row: Math.max(row, 1), col });
      return;
    case "row-below":
      commit(wrap, insertRow(t, row + 1), "input.table", { row: row + 1, col });
      return;
    case "col-left":
      commit(wrap, insertColumn(t, col), "input.table", { row, col });
      return;
    case "col-right":
      commit(wrap, insertColumn(t, col + 1), "input.table", { row, col: col + 1 });
      return;
    case "align-left":
      aligned("left");
      return;
    case "align-center":
      aligned("center");
      return;
    case "align-right":
      aligned("right");
      return;
    case "delete-row":
      commit(wrap, deleteRow(t, row), "delete.table", {
        row: Math.min(row, t.rows.length - 2),
        col,
      });
      return;
    case "delete-col":
      commit(wrap, deleteColumn(t, col), "delete.table", {
        row,
        col: Math.max(0, Math.min(col, width(t) - 2)),
      });
      return;
    case "delete-table": {
      const { view } = state;
      const range = tableRange(view.state, view.posAtDOM(wrap));
      if (!range) return;
      view.focus();
      view.dispatch({
        changes: { from: range.from, to: range.to, insert: "" },
        selection: { anchor: range.from },
        userEvent: "delete.table",
      });
      return;
    }
  }
}

function wire(wrap: HTMLElement, view: EditorView, addRow: HTMLElement, addCol: HTMLElement) {
  const current = () => live.get(wrap)?.table;

  wrap.addEventListener("focusin", (e) => {
    const cell = e.target as HTMLElement;
    if (!cell.dataset.row) return;
    // While typed in, a cell shows its Markdown, "|" plain.
    cell.textContent = cellText(cell.dataset.raw ?? "");
    requestAnimationFrame(() => {
      if (document.activeElement === cell) focusCell(cell);
    });
  });

  wrap.addEventListener("focusout", (e) => {
    const cell = e.target as HTMLElement;
    if (!cell.dataset.row) return;
    const { row, col } = position(cell);
    showRendered(cell, current()?.rows[row]?.cells[col] ?? "");
  });

  wrap.addEventListener("input", (e) => {
    const cell = e.target as HTMLElement;
    const t = current();
    if (!cell.dataset.row || !t || (e instanceof InputEvent && e.isComposing)) return;
    const { row, col } = position(cell);
    const raw = cellRaw(cell.innerText.replace(/\n$/, ""));
    cell.dataset.raw = raw;
    commit(wrap, setCell(t, row, col, raw), "input.type");
  });

  wrap.addEventListener("compositionend", (e) => {
    const cell = e.target as HTMLElement;
    cell.dispatchEvent(new InputEvent("input", { bubbles: true }));
  });

  wrap.addEventListener("keydown", (e) => {
    const cell = e.target as HTMLElement;
    const t = current();
    if (!cell.dataset.row || !t || e.isComposing) return;
    const { row, col } = position(cell);
    const last = { row: t.rows.length - 1, col: width(t) - 1 };
    const mod = e.metaKey || e.ctrlKey;
    const go = (r: number, c: number) => {
      const target = cellAt(wrap, r, c);
      if (target) focusCell(target);
    };
    let handled = true;
    if (e.key === "Tab" && !e.shiftKey) {
      if (col < last.col) go(row, col + 1);
      else if (row < last.row) go(row + 1, 0);
      else commit(wrap, insertRow(t, t.rows.length), "input.table", { row: row + 1, col: 0 });
    } else if (e.key === "Tab") {
      if (col > 0) go(row, col - 1);
      else if (row > 0) go(row - 1, last.col);
    } else if (e.key === "Enter" && mod) {
      commit(wrap, insertRow(t, row + 1), "input.table", { row: row + 1, col });
    } else if (e.key === "Enter") {
      if (row < last.row) go(row + 1, col);
      else commit(wrap, insertRow(t, t.rows.length), "input.table", { row: row + 1, col });
    } else if (e.key === "ArrowUp" && !mod) {
      if (row > 0) go(row - 1, col);
      else leave(wrap, "before");
    } else if (e.key === "ArrowDown" && !mod) {
      if (row < last.row) go(row + 1, col);
      else leave(wrap, "after");
    } else if (e.key === "Escape") {
      leave(wrap, "after");
    } else if (mod && e.key.toLowerCase() === "z") {
      (e.shiftKey ? redo : undo)(view);
    } else if (mod && e.key.toLowerCase() === "y") {
      redo(view);
    } else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  wrap.addEventListener("contextmenu", (e) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>("[data-row]");
    const t = current();
    if (!cell || !t) return;
    e.preventDefault();
    const { row, col } = position(cell);
    const a = t.align[col];
    // The bridge is loaded when a menu opens, so this module loads outside a browser too.
    void import("../../bridge.ts")
      .then(({ anur }) =>
        anur.call("menu:popup", {
          items: [
            { id: "row-above", label: "Insert row above", enabled: row > 0 },
            { id: "row-below", label: "Insert row below" },
            { id: "col-left", label: "Insert column left" },
            { id: "col-right", label: "Insert column right" },
            { separator: true },
            { id: "align-left", label: "Align column left", checked: a === "left" },
            { id: "align-center", label: "Align column centre", checked: a === "center" },
            { id: "align-right", label: "Align column right", checked: a === "right" },
            { separator: true },
            { id: "delete-row", label: "Delete row", enabled: row > 0 },
            { id: "delete-col", label: "Delete column", enabled: width(t) > 1 },
            { id: "delete-table", label: "Delete table" },
          ],
        }),
      )
      .then(({ id }) => {
        if (id) apply(wrap, id as Action, row, col);
      });
  });

  // The + handles: one below the row under the pointer, one right of the column.
  let hover = { row: 0, col: 0 };
  wrap.addEventListener("mousemove", (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains("cm-lp-add")) return;
    const cell = target.closest<HTMLElement>("[data-row]");
    if (!cell) return;
    hover = position(cell);
    const tr = cell.parentElement;
    const header = cellAt(wrap, 0, hover.col);
    const table = wrap.querySelector("table");
    if (!tr || !header || !table) return;
    addRow.hidden = false;
    addRow.style.top = `${String(table.offsetTop + tr.offsetTop + tr.offsetHeight - 9)}px`;
    addCol.hidden = false;
    addCol.style.left = `${String(table.offsetLeft + header.offsetLeft + header.offsetWidth - 9)}px`;
  });
  wrap.addEventListener("mouseleave", () => {
    addRow.hidden = true;
    addCol.hidden = true;
  });
  for (const button of [addRow, addCol]) {
    button.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });
  }
  addRow.addEventListener("click", () => {
    apply(wrap, "row-below", hover.row, hover.col);
  });
  addCol.addEventListener("click", () => {
    apply(wrap, "col-right", hover.row, hover.col);
  });
}
