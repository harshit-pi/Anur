import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FolderState } from "../../shared/ipc-contract.ts";
import {
  copyInto,
  createFolder,
  duplicateDoc,
  moveEntry,
  restoreEntry,
  trashEntry,
} from "./file-ops.ts";
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
      return Promise.resolve(null);
    };
    expect(await trashEntry(f, "Ideas", trash)).toEqual({
      kind: "trashed",
      docs: ["Ideas/Deep/Box.md", "Ideas/Gift.md"],
      trashed: null,
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

describe("copyInto", () => {
  const outside = () => {
    const dir = mkdtempSync(path.join(tmpdir(), "anur-outside-"));
    writeFileSync(path.join(dir, "Plan.md"), "# From Finder\n");
    writeFileSync(path.join(dir, "photo.png"), "png");
    mkdirSync(path.join(dir, "Trip"));
    writeFileSync(path.join(dir, "Trip", "Day 1.md"), "# Day 1\n");
    return dir;
  };

  it("copies files and folders in, a taken name getting ' copy'", async () => {
    const f = await folder();
    const src = outside();
    const r = await copyInto(
      f,
      ["Plan.md", "photo.png", "Trip"].map((n) => path.join(src, n)),
      "",
    );
    expect(r).toEqual({ kind: "copied", paths: ["Plan copy.md", "photo.png", "Trip"] });
    expect(readFileSync(path.join(f.path, "Plan.md"), "utf8")).toBe("# Plan\n");
    expect(readFileSync(path.join(f.path, "Plan copy.md"), "utf8")).toBe("# From Finder\n");
    expect(existsSync(path.join(f.path, "Trip", "Day 1.md"))).toBe(true);
    expect(existsSync(path.join(src, "Plan.md"))).toBe(true);
  });

  it("copies into a folder, and copies a file of the folder beside itself", async () => {
    const f = await folder();
    const r = await copyInto(f, [path.join(f.path, "Ideas", "Gift.md")], "Ideas");
    expect(r).toEqual({ kind: "copied", paths: ["Ideas/Gift copy.md"] });
    const again = await copyInto(f, [path.join(f.path, "Ideas", "Gift.md")], "Ideas");
    expect(again).toEqual({ kind: "copied", paths: ["Ideas/Gift copy 2.md"] });
  });

  it("won't copy a folder inside itself, nor into a folder that isn't there", async () => {
    const f = await folder();
    expect((await copyInto(f, [path.join(f.path, "Ideas")], "Ideas/Deep")).kind).toBe("failed");
    expect((await copyInto(f, [path.join(f.path, "Plan.md")], "Nope")).kind).toBe("failed");
    expect((await copyInto(f, [path.join(f.path, "Plan.md")], "../x")).kind).toBe("failed");
  });

  it("skips hidden files and refuses a read-only folder", async () => {
    const f = await folder();
    const src = outside();
    writeFileSync(path.join(src, ".DS_Store"), "");
    expect(await copyInto(f, [path.join(src, ".DS_Store")], "")).toEqual({
      kind: "copied",
      paths: [],
    });
    const ro = await folder("read-only");
    expect((await copyInto(ro, [path.join(src, "Plan.md")], "")).kind).toBe("failed");
  });
});

describe("restoreEntry", () => {
  /** A stand-in Trash: a folder named .Trash beside the test folder. */
  const fakeTrash = (f: FolderState) => {
    const bin = path.join(path.dirname(f.path), `${path.basename(f.path)}-bin`, ".Trash");
    mkdirSync(bin, { recursive: true });
    return (full: string) => {
      const place = path.join(bin, path.basename(full));
      renameSync(full, place);
      return Promise.resolve(place);
    };
  };
  const inTrash = (full: string) => full.includes("/.Trash/");

  it("puts a trashed folder back where it was, docs and all", async () => {
    const f = await folder();
    const gone = await trashEntry(f, "Ideas", fakeTrash(f));
    if (gone.kind !== "trashed" || !gone.trashed) throw new Error("not trashed");
    expect(existsSync(path.join(f.path, "Ideas"))).toBe(false);
    const after = await describe_(f.path);
    expect(await restoreEntry(after, "Ideas", gone.trashed, inTrash)).toEqual({
      kind: "restored",
      path: "Ideas",
    });
    expect(readFileSync(path.join(f.path, "Ideas", "Deep", "Box.md"), "utf8")).toBe("# Box\n");
  });

  it("won't write over a new file in its place, nor take from outside a Trash", async () => {
    const f = await folder();
    const gone = await trashEntry(f, "Plan.md", fakeTrash(f));
    if (gone.kind !== "trashed" || !gone.trashed) throw new Error("not trashed");
    writeFileSync(path.join(f.path, "Plan.md"), "# New plan\n");
    const r = await restoreEntry(f, "Plan.md", gone.trashed, inTrash);
    expect(r.kind).toBe("failed");
    expect(readFileSync(path.join(f.path, "Plan.md"), "utf8")).toBe("# New plan\n");
    expect(existsSync(gone.trashed)).toBe(true);
    const elsewhere = path.join(f.path, "Ideas", "Gift.md");
    expect((await restoreEntry(f, "Gift.md", elsewhere, inTrash)).kind).toBe("failed");
    expect(existsSync(elsewhere)).toBe(true);
  });

  it("says to use Put Back when the item has left the Trash", async () => {
    const f = await folder();
    const r = await restoreEntry(f, "Plan.md", "/nowhere/.Trash/Plan.md", inTrash);
    expect(r).toEqual({
      kind: "failed",
      reason:
        "Plan.md is no longer where it was in the Trash. Find Plan.md in the Trash and choose Put Back.",
    });
  });
});
