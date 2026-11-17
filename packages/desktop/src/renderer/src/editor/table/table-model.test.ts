import { describe, expect, it } from "vitest";
import {
  blankTable,
  cellRaw,
  cellText,
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  parseTable,
  serializeTable,
  setAlign,
  setCell,
  type Table,
} from "./table-model.ts";

const SOURCE = [
  "| Stage    | Who        | Share |",
  "| :------- | :--------- | ----: |",
  "| Internal | Tally team |    1% |",
  "| Beta     | **50**     |   10% |",
].join("\n");

const table = () => parseTable(SOURCE) as Table;

describe("a Markdown table", () => {
  it("reads cells and alignment", () => {
    const t = table();
    expect(t.rows.map((r) => r.cells)).toEqual([
      ["Stage", "Who", "Share"],
      ["Internal", "Tally team", "1%"],
      ["Beta", "**50**", "10%"],
    ]);
    expect(t.align).toEqual(["left", "left", "right"]);
  });

  it("comes back unchanged when nothing is edited", () => {
    expect(serializeTable(table())).toBe(SOURCE);
  });

  it("rewrites only the row whose cell changed", () => {
    const out = serializeTable(setCell(table(), 1, 1, "Ops")).split("\n");
    expect(out[2]).toBe("| Internal | Ops | 1% |");
    expect(out.filter((l, i) => l !== SOURCE.split("\n")[i])).toHaveLength(1);
  });

  it("inserts and deletes rows, never the header", () => {
    const added = insertRow(table(), 2);
    expect(serializeTable(added).split("\n")[3]).toBe("|  |  |  |");
    expect(deleteRow(table(), 0)).toEqual(table());
    expect(serializeTable(deleteRow(table(), 1))).not.toContain("Internal");
    expect(insertRow(table(), 0).rows[0]?.cells[0]).toBe("Stage");
  });

  it("inserts and deletes columns, keeping alignment in step", () => {
    const t = insertColumn(table(), 1);
    expect(t.align).toEqual(["left", null, "left", "right"]);
    expect(serializeTable(t).split("\n").slice(0, 2)).toEqual([
      "| Stage |  | Who | Share |",
      "| :--- | --- | :--- | ---: |",
    ]);
    expect(deleteColumn(t, 1)).toMatchObject({ align: ["left", "left", "right"] });
    const one = parseTable("| a |\n| - |") as Table;
    expect(deleteColumn(one, 0)).toBe(one);
  });

  it("sets a column's alignment in the delimiter row", () => {
    const out = serializeTable(setAlign(table(), 0, "center")).split("\n")[1];
    expect(out).toBe("| :---: | :--- | ---: |");
  });

  it("pads short rows and trims long ones to the header's width", () => {
    const t = parseTable("| a | b |\n| - | - |\n| 1 |\n| 1 | 2 | 3 |") as Table;
    expect(t.rows.map((r) => r.cells)).toEqual([
      ["a", "b"],
      ["1", ""],
      ["1", "2"],
    ]);
  });

  it("escapes a typed pipe, and shows an escaped one plainly", () => {
    expect(cellRaw("a | b")).toBe("a \\| b");
    expect(cellRaw("a \\| b")).toBe("a \\| b");
    expect(cellRaw("||")).toBe("\\|\\|");
    expect(cellText("a \\| b")).toBe("a | b");
    expect(cellRaw("two\nlines")).toBe("two lines");
  });

  it("makes a blank table to insert", () => {
    expect(blankTable(2, 1)).toBe("| Column 1 | Column 2 |\n| --- | --- |\n|  |  |");
  });
});
