import { describe, expect, it } from "vitest";
import { buildSectionTree } from "./tree.ts";
import { systemDocText, systemIdsOf, systemIndexOf } from "./system-doc.ts";

const boxes = [
  { id: "repo:a1", path: ["tally-api"], text: "acme/api", parent: null },
  { id: "group:a1/pay", path: ["tally-api", "Payments"], text: "2 parts", parent: "repo:a1" },
  {
    id: "part:p1",
    path: ["tally-api", "Checkout"],
    text: "stack in bin/app.ts",
    parent: "group:a1/pay",
  },
  { id: "repo:w1", path: ["tally-web"], text: "acme/web", parent: null },
];

describe("the system map as a doc (29.1)", () => {
  it("nests each box as the map does, with its ID read back from the text", () => {
    const text = systemDocText(boxes);
    const tree = buildSectionTree(text, { fileName: "system" });
    expect(tree.sections.map((s) => s.path.join(" › "))).toEqual([
      "System",
      "System › tally-api",
      "System › tally-api › Payments",
      "System › tally-api › Payments › Checkout",
      "System › tally-web",
    ]);
    expect(systemIdsOf(tree, text)).toEqual([
      null,
      "repo:a1",
      "group:a1/pay",
      "part:p1",
      "repo:w1",
    ]);
    expect(systemIndexOf(tree, text, "part:p1")).toBe(3);
  });

  it("puts a box whose parent is unknown at the top, and stops nesting at six levels", () => {
    const deep = Array.from({ length: 7 }, (_, i) => ({
      id: `b${String(i)}`,
      path: [`B${String(i)}`],
      text: "",
      parent: i ? `b${String(i - 1)}` : "missing",
    }));
    const text = systemDocText(deep);
    const tree = buildSectionTree(text, { fileName: "system" });
    expect(systemIdsOf(tree, text).filter(Boolean)).toHaveLength(7);
    expect(tree.sections[1]?.path).toEqual(["System", "B0"]);
  });
});
