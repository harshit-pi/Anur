import { describe, expect, it } from "vitest";
import type { ThreadItem } from "../../../shared/ipc-contract.ts";
import { mergeLanded } from "./landed-notes.ts";

const landed = (id: string, section: string, more: Partial<ThreadItem> = {}): ThreadItem =>
  ({
    kind: "auto-used",
    id,
    doc: "Anur.md",
    sections: [["Anur", section]],
    undoable: false,
    undone: false,
    ...more,
  }) as ThreadItem;
const person = (text: string): ThreadItem =>
  ({ kind: "message", role: "person", text }) as unknown as ThreadItem;

describe("mergeLanded", () => {
  it("makes a turn's landed edits to one doc one line", () => {
    const out = mergeLanded([
      person("split it"),
      landed("a", "Go-to-market"),
      landed("b", "First users"),
      landed("c", "Channels"),
      landed("d", "Channels"),
    ]);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({
      sections: [
        ["Anur", "Go-to-market"],
        ["Anur", "First users"],
        ["Anur", "Channels"],
      ],
    });
  });

  it("keeps each turn, each doc, and anything undoable or taken back apart", () => {
    const out = mergeLanded([
      person("one"),
      landed("a", "A"),
      landed("b", "B", { doc: "Pricing.md" }),
      landed("c", "C", { undoable: true }),
      landed("d", "D", { undone: true }),
      person("two"),
      landed("e", "E"),
    ]);
    expect(out.filter((x) => x.kind === "auto-used")).toHaveLength(5);
  });
});
