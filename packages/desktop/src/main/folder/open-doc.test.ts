import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FolderService } from "./folder-service.ts";
import { openDoc } from "./open-doc.ts";

let base: string;
let vault: string;
beforeEach(() => {
  base = realpathSync(mkdtempSync(path.join(tmpdir(), "anur-opendoc-")));
  vault = path.join(base, "Vault");
  mkdirSync(path.join(vault, "notes"), { recursive: true });
  writeFileSync(path.join(vault, "notes", "Plan.md"), "# Plan\r\n\r\n## Retry\r\n");
  writeFileSync(path.join(base, "secret.md"), "outside");
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

async function opened() {
  const r = await new FolderService(path.join(base, "AppSupport"), base).open(1, vault);
  if (r.kind !== "opened") throw new Error("expected the folder to open");
  return r.folder;
}

describe("opening a doc for the page", () => {
  it('reads a listed doc, with "\\n" endings for the editor', async () => {
    expect(await openDoc(await opened(), "notes/Plan.md")).toEqual({
      kind: "doc",
      path: "notes/Plan.md",
      text: "# Plan\n\n## Retry\n",
      mode: "editable",
      note: null,
    });
  });

  it.each([
    "../secret.md",
    "/etc/hosts",
    "notes/../../secret.md",
    "missing.md",
    ".anur/format.json",
  ])("refuses %s", async (p) => {
    expect(await openDoc(await opened(), p)).toMatchObject({ kind: "failed" });
  });

  it("opens a doc read-only when the folder is", async () => {
    const folder = { ...(await opened()), mode: "read-only" as const, reason: "Newer format." };
    expect(await openDoc(folder, "notes/Plan.md")).toMatchObject({
      mode: "read-only",
      note: "Newer format.",
    });
  });
});
