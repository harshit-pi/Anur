/**
 * A Markdown table as rows of cells (task 2.9), and the edits the page makes
 * to it. Cells hold their Markdown as written, "\|" escapes included. When a
 * table is written back, every row nobody changed keeps its original line,
 * padding and all, so an edit touches only the lines it must.
 */

export type Align = "left" | "center" | "right" | null;

export type Row = { cells: string[]; original: string | null };

export type Table = {
  /** Row 0 is the header. */
  rows: Row[];
  align: Align[];
  /** The delimiter line as written, until columns or alignment change. */
  delimiter: string | null;
};

/** A row's cells, split at "|" but not at an escaped "\|". */
export function splitRow(row: string): string[] {
  let s = row.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (c === "\\" && s.charAt(i + 1) === "|") {
      cur += "\\|";
      i++;
    } else if (c === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

function alignOf(cell: string): Align {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  return left && right ? "center" : right ? "right" : left ? "left" : null;
}

export function parseTable(text: string): Table | null {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  const [head, delimiter, ...body] = lines;
  if (head === undefined || delimiter === undefined) return null;
  const width = splitRow(head).length;
  const fit = (cells: string[]) =>
    cells.length >= width
      ? cells.slice(0, width)
      : [...cells, ...Array<string>(width - cells.length).fill("")];
  return {
    rows: [head, ...body].map((line) => ({ cells: fit(splitRow(line)), original: line })),
    align: fit(splitRow(delimiter)).map(alignOf),
    delimiter,
  };
}

const DELIMITER: Record<string, string> = { left: ":---", center: ":---:", right: "---:" };

export function serializeTable(table: Table): string {
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  const delimiter =
    table.delimiter ?? line(table.align.map((a) => (a ? DELIMITER[a] : "---") ?? "---"));
  const rows = table.rows.map((r) => r.original ?? line(r.cells));
  const [head, ...body] = rows;
  return [head ?? "", delimiter, ...body].join("\n");
}

export const width = (t: Table) => t.align.length;

const blankRow = (t: Table): Row => ({ cells: Array<string>(width(t)).fill(""), original: null });

/** Every row rewritten, as after a column change. */
const rewritten = (rows: Row[]): Row[] => rows.map((r) => ({ cells: r.cells, original: null }));

export function setCell(t: Table, row: number, col: number, value: string): Table {
  const current = t.rows[row];
  if (!current || col < 0 || col >= width(t) || current.cells[col] === value) return t;
  const cells = current.cells.map((c, i) => (i === col ? value : c));
  return { ...t, rows: t.rows.map((r, i) => (i === row ? { cells, original: null } : r)) };
}

/** A blank row at `index`; the header (0) stays first, so the lowest index is 1. */
export function insertRow(t: Table, index: number): Table {
  const at = Math.min(Math.max(index, 1), t.rows.length);
  return { ...t, rows: [...t.rows.slice(0, at), blankRow(t), ...t.rows.slice(at)] };
}

/** Deletes a body row; the header can't be deleted. */
export function deleteRow(t: Table, index: number): Table {
  if (index < 1 || index >= t.rows.length) return t;
  return { ...t, rows: t.rows.filter((_, i) => i !== index) };
}

export function insertColumn(t: Table, index: number): Table {
  const at = Math.min(Math.max(index, 0), width(t));
  const insert = <T>(xs: T[], x: T) => [...xs.slice(0, at), x, ...xs.slice(at)];
  return {
    rows: rewritten(t.rows.map((r) => ({ ...r, cells: insert(r.cells, "") }))),
    align: insert<Align>(t.align, null),
    delimiter: null,
  };
}

/** Deletes a column; the last one can't be deleted. */
export function deleteColumn(t: Table, index: number): Table {
  if (width(t) <= 1 || index < 0 || index >= width(t)) return t;
  const drop = <T>(xs: T[]) => xs.filter((_, i) => i !== index);
  return {
    rows: rewritten(t.rows.map((r) => ({ ...r, cells: drop(r.cells) }))),
    align: drop(t.align),
    delimiter: null,
  };
}

export function setAlign(t: Table, col: number, align: Align): Table {
  if (col < 0 || col >= width(t) || t.align[col] === align) return t;
  return { ...t, align: t.align.map((a, i) => (i === col ? align : a)), delimiter: null };
}

/** A new table to insert: a header row and `rows` body rows, all blank. */
export function blankTable(columns: number, rows: number): string {
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  const header = line(Array.from({ length: columns }, (_, i) => `Column ${String(i + 1)}`));
  const delim = line(Array<string>(columns).fill("---"));
  const body = Array.from({ length: rows }, () => line(Array<string>(columns).fill("")));
  return [header, delim, ...body].join("\n");
}

/** A cell as the person types it: "|" plain. */
export const cellText = (raw: string) => raw.replace(/\\\|/g, "|");
/** A cell as the file stores it: "|" escaped, on one line. */
export const cellRaw = (text: string) =>
  text
    .replace(/\r?\n/g, " ")
    .replace(/(^|[^\\])\|/g, "$1\\|")
    .replace(/(^|[^\\])\|/g, "$1\\|");
