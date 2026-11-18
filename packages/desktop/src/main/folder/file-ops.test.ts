import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FolderState } from "../../shared/ipc-contract.ts";
import { createFolder, duplicateDoc, moveEntry, trashEntry } from "./file-ops.ts";
import { listDocs } from "./list-docs.ts";

/** Plan.md, Ideas/Gift.md, Ideas/Deep/Box.md, an empty Archive and a code-only src. */
async function folder(mode: FolderState["mode"] = "writable"): Promise<FolderState> {
  const root = mkdtempSync(path.join(tmpdir(), "anur-files-"));
  mkdirSync(path.join(root, "Ideas", "Deep"), { recursive: true });
  mkdirSync(path.join(root, "Archive"));
  mkdirSync(path.join(root, "src"));
  mkdirSync(path.join(root, ".anur"));
  writeFileSync(path.join(root, "Plan.md"), "# Plan\n");
  writeFileSync(path.join(root, "Ideas", "Gift.md"), "# Gift\n");
  writeFileSync(path.join(root, "Ideas", "Deep", "Box.md"), "# Box\n");
  writeFileSync(path.join(root, "src", "main.ts"), "");
  return describe_(root, mode);
}
async function describe_(
  root: string,
  mode: FolderState["mode"] = "writable",
): Promise<FolderState> {
  const { docs, folders, files } = await listDocs(root);
  return {
    name: "f",
    path: root,
    mode,
    reason: null,
    docs,
    folders,
    files,
    times: {},
    truncated: false,
    cloud: null,
    gitInCloud: false,
    offloaded: [],
    conflicts: [],
  };
}

describe("the files panel on disk", () => {
  it("lists folders holding docs and empty ones, never code-only or hidden ones", async () => {
    const f = await folder();
    expect(f.folders).toEqual(["Archive", "Ideas", "Ideas/Deep"]);
  });

  it("makes a folder, but not over one that's there, a hidden one or outside", async () => {
    const f = await folder();
    expect(await createFolder(f, "Ideas/New")).toEqual({ kind: "created", path: "Ideas/New" });
    expect((await describe_(f.path)).folders).toContain("Ideas/New");
    expect(await createFolder(f, "Ideas")).toEqual({
      kind: "failed",
      reason: "Ideas already exists.",
    });
    expect((await createFolder(f, ".secret")).kind).toBe("failed");
    expect((await createFolder(f, "../out")).kind).toBe("failed");
    expect((await createFolder(await folder("read-only"), "X")).kind).toBe("failed");
  });

  it("renames and moves a doc, and says which docs moved", async () => {
    const f = await folder();
    expect(await moveEntry(f, "Plan.md", "Ideas/Plan B.md")).toEqual({
      kind: "moved",
      to: "Ideas/Plan B.md",
      docs: [{ from: "Plan.md", to: "Ideas/Plan B.md" }],
    });
    expect(readFileSync(path.join(f.path, "Ideas", "Plan B.md"), "utf8")).toBe("# Plan\n");
    expect(existsSync(path.join(f.path, "Plan.md"))).toBe(false);
  });

  it("moves a folder with every doc inside it", async () => {
    const f = await folder();
    const r = await moveEntry(f, "Ideas", "Archive/Ideas");
    expect(r).toEqual({
      kind: "moved",
      to: "Archive/Ideas",
      docs: [
        { from: "Ideas/Deep/Box.md", to: "Archive/Ideas/Deep/Box.md" },
        { from: "Ideas/Gift.md", to: "Archive/Ideas/Gift.md" },
      ],
    });
    expect(existsSync(path.join(f.path, "Archive", "Ideas", "Deep", "Box.md"))).toBe(true);
  });

  it("changes only a name's case, which a Mac sees as the same file", async () => {
    const f = await folder();
    expect((await moveEntry(f, "Plan.md", "plan.md")).kind).toBe("moved");
    expect((await describe_(f.path)).docs).toContain("plan.md");
  });

  it("never writes over a file, puts a folder in itself, drops .md or goes hidden", async () => {
    const f = await folder();
    writeFileSync(path.join(f.path, "Ideas", "Plan.md"), "theirs");
    expect(await moveEntry(f, "Plan.md", "Ideas/Plan.md")).toEqual({
      kind: "failed",
      reason: "There's already a Plan.md there.",
    });
    expect(readFileSync(path.join(f.path, "Ideas", "Plan.md"), "utf8")).toBe("theirs");
    expect((await moveEntry(f, "Ideas", "Ideas/Deep/Ideas")).kind).toBe("failed");
    expect((await moveEntry(f, "Plan.md", "Plan.txt")).kind).toBe("failed");
    expect((await moveEntry(f, "Plan.md", ".anur/Plan.md")).kind).toBe("failed");
    expect((await moveEntry(f, "src/main.ts", "main.ts")).kind).toBe("failed");
    expect((await moveEntry(f, "Plan.md", "Nowhere/Plan.md")).kind).toBe("failed");
  });

  it("duplicates a doc beside it", async () => {
    const f = await folder();
    expect(await duplicateDoc(f, "Ideas/Gift.md")).toEqual({
      kind: "created",
      path: "Ideas/Gift copy.md",
    });
    expect(await duplicateDoc(f, "Ideas/Gift.md")).toEqual({
      kind: "created",
      path: "Ideas/Gift copy 2.md",
    });
  });

  it("trashes a doc or a folder with the docs inside, through the system Trash", async () => {
    const f = await folder();
    const trashed: string[] = [];
    const trash = (full: string) => {
      trashed.push(path.relative(f.path, full));
      return Promise.resolve();
    };
    expect(await trashEntry(f, "Ideas", trash)).toEqual({
      kind: "trashed",
      docs: ["Ideas/Deep/Box.md", "Ideas/Gift.md"],
    });
    expect(trashed).toEqual(["Ideas"]);
    expect((await trashEntry(f, "src", trash)).kind).toBe("failed");
    expect(
      await trashEntry(f, "Plan.md", () => Promise.reject(new Error("no Trash here"))),
    ).toEqual({ kind: "failed", reason: "Couldn't move it to the Trash: no Trash here" });
  });

  it("shows images, PDFs and other attachments, and moves and copies them keeping their ending", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "anur-files-"));
    mkdirSync(path.join(root, "attachments"));
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, "Plan.md"), "# Plan\n");
    writeFileSync(path.join(root, "attachments", "photo.png"), "png");
    writeFileSync(path.join(root, "attachments", "spec.pdf"), "pdf");
    writeFileSync(path.join(root, "src", "main.ts"), "");
    writeFileSync(path.join(root, "notes.txt"), "");
    const f = await describe_(root);
    expect(f.files).toEqual(["attachments/photo.png", "attachments/spec.pdf"]);
    expect(f.folders).toEqual(["attachments"]);
    expect(await moveEntry(f, "attachments/photo.png", "Cover.png")).toEqual({
      kind: "moved",
      to: "Cover.png",
      docs: [{ from: "attachments/photo.png", to: "Cover.png" }],
    });
    expect(await moveEntry(f, "attachments/spec.pdf", "attachments/spec.md")).toEqual({
      kind: "failed",
      reason: "The name has to end in .pdf.",
    });
    expect(await duplicateDoc(f, "attachments/spec.pdf")).toEqual({
      kind: "created",
      path: "attachments/spec copy.pdf",
    });
  });
});
