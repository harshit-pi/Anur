import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildSectionTree, type SectionToSave } from "@anur/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DocIds } from "./doc-ids.ts";
import { SectionIds } from "./section-ids.ts";

let anurDir: string;
beforeEach(() => {
  anurDir = path.join(mkdtempSync(path.join(tmpdir(), "anur-sectionids-")), ".anur");
});
afterEach(() => {
  rmSync(path.dirname(anurDir), { recursive: true, force: true });
});

const sectionsOf = (doc: string): SectionToSave[] =>
  buildSectionTree(doc, { fileName: "doc.md" }).sections.map((s) => ({
    path: s.path,
    ordinal: s.ordinal,
  }));

describe("section IDs on disk", () => {
  it("stay the same when a rename is written to the log and the folder is read again", async () => {
    const docIds = new DocIds(anurDir, "dev1");
    await docIds.load();
    const doc = await docIds.idFor("doc.md");
    const before = "# T\n\n## Retry timing\n\n## Channel\n";
    const after = "# T\n\n## Retry schedule\n\n## Channel\n";

    const first = await new SectionIds(anurDir, "dev1").save(doc, sectionsOf(before));
    const carried = sectionsOf(after).map((s, i) => ({ ...s, carried: first[i] ?? null }));
    await new SectionIds(anurDir, "dev1").save(doc, carried);

    const reread = await new SectionIds(anurDir, "dev2").save(doc, sectionsOf(after));
    expect(reread).toEqual(first);

    const again = new DocIds(anurDir, "dev2");
    await again.load();
    expect(await again.idFor("doc.md")).toBe(doc);
  });

  it("list an orphan and reattach it", async () => {
    const docIds = new DocIds(anurDir, "dev1");
    await docIds.load();
    const doc = await docIds.idFor("doc.md");
    const ids = new SectionIds(anurDir, "dev1");
    const first = await ids.save(doc, sectionsOf("# T\n\n## A\n\n## B\n"));
    await ids.save(doc, sectionsOf("# T\n\n## A\n"));
    const [orphan] = await ids.orphaned(doc);
    expect(orphan?.id).toBe(first[2]);
    const onto = first[1];
    if (!orphan || !onto) throw new Error("missing IDs");
    await ids.reattach(doc, orphan.id, onto);
    expect(await ids.orphaned(doc)).toEqual([]);
    await expect(ids.reattach(doc, onto, onto)).rejects.toThrow(/not orphaned/);
  });
});
