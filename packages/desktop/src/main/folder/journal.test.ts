import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Journal } from "./journal.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "anur-journal-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const entry = (p: string) => ({ path: p, mine: "Mine.", theirs: "Theirs.", before: "", after: "" });

describe("the journal of kept typing", () => {
  it("keeps entries per folder and per doc, across instances", async () => {
    const a = new Journal(dir);
    await a.keep("/Vault", entry("Plan.md"));
    await a.keep("/Vault", entry("Other.md"));
    await a.keep("/Elsewhere", entry("Plan.md"));
    const b = new Journal(dir);
    expect((await b.list("/Vault", "Plan.md")).map((e) => e.mine)).toEqual(["Mine."]);
    expect(await b.list("/Vault", "Missing.md")).toEqual([]);
  });

  it("drops an entry once dismissed or put back", async () => {
    const j = new Journal(dir);
    const kept = await j.keep("/Vault", entry("Plan.md"));
    await j.drop("/Vault", kept.id);
    expect(await j.list("/Vault", "Plan.md")).toEqual([]);
  });

  it("starts empty when nothing was kept", async () => {
    expect(await new Journal(dir).list("/Vault", "Plan.md")).toEqual([]);
  });
});
