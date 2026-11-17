import { describe, expect, it } from "vitest";
import { DocId } from "../sections/section.ts";
import { buildDocRegistry, docIdFor, normalizeDocPath, type DocIdLine } from "./doc-ids.ts";
import { hashId, mintId } from "./mint.ts";

let n = 0;
const env = (dev = "dev1") => ({
  id: `line-${String(++n).padStart(4, "0")}`,
  at: `2026-11-17T01:00:${String(n).padStart(2, "0")}.000Z`,
  dev,
  seq: n,
});
const mint = (doc: string, p: string, dev?: string): DocIdLine => ({
  ...env(dev),
  kind: "doc-mint",
  doc: DocId.parse(doc),
  path: p,
});

describe("minting", () => {
  it("is the same on every device", () => {
    expect(hashId(["doc", "plans/Retry.md"])).toBe(hashId(["doc", "plans/Retry.md"]));
    expect(hashId(["doc", "plans/Retry.md"])).toMatch(/^[0-9a-f]{16}$/);
  });

  it("hashes a taken ID again with the ID that holds it", () => {
    const first = hashId(["doc", "a.md"]);
    expect(mintId(["doc", "a.md"], (id) => id === first)).toBe(hashId(["doc", "a.md", first]));
  });
});

describe("doc paths", () => {
  it("are relative, with forward slashes, in NFC", () => {
    expect(normalizeDocPath("./plans\\Retry.md")).toBe("plans/Retry.md");
    expect(normalizeDocPath("Cafe\u0301.md")).toBe("Caf\u00e9.md");
  });

  it.each(["", "/abs/x.md", "C:/x.md", "../x.md", "a/../x.md", "a//x.md"])("refuse %j", (p) => {
    expect(() => normalizeDocPath(p)).toThrow();
  });
});

describe("doc IDs", () => {
  it("are minted from the path when first seen, then kept", () => {
    const empty = buildDocRegistry([]);
    const first = docIdFor(empty, "plans/Retry.md");
    expect(first.isNew).toBe(true);
    const reg = buildDocRegistry([mint(first.doc, "plans/Retry.md")]);
    expect(docIdFor(reg, "./plans/Retry.md")).toEqual({ doc: first.doc, isNew: false });
  });

  it("follow a move, and give the old path to a new doc", () => {
    const id = DocId.parse(hashId(["doc", "a.md"]));
    const reg = buildDocRegistry([
      mint(id, "a.md"),
      { ...env(), kind: "doc-move", doc: id, from: "a.md", to: "b.md" },
    ]);
    expect(docIdFor(reg, "b.md")).toEqual({ doc: id, isNew: false });
    const fresh = docIdFor(reg, "a.md");
    expect(fresh.isNew).toBe(true);
    expect(fresh.doc).not.toBe(id);
  });

  it("give a new file at an orphaned doc's path its own ID", () => {
    const id = DocId.parse(hashId(["doc", "a.md"]));
    const reg = buildDocRegistry([
      mint(id, "a.md"),
      { ...env(), kind: "doc-orphaned", doc: id, path: "a.md" },
    ]);
    const fresh = docIdFor(reg, "a.md");
    expect(fresh).toEqual({ doc: hashId(["doc", "a.md", id]), isNew: true });
    expect(reg.byId.get(id)).toEqual({ path: "a.md", orphaned: true });
  });

  it("agree across devices that minted the same path", () => {
    const id = DocId.parse(hashId(["doc", "a.md"]));
    const reg = buildDocRegistry([mint(id, "a.md", "dev1"), mint(id, "a.md", "dev2")]);
    expect(reg.byPath.get("a.md")).toBe(id);
    expect(reg.byId.size).toBe(1);
  });
});
