import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findImage, readImage } from "./images.ts";

async function folder() {
  const root = await mkdtemp(path.join(tmpdir(), "anur-images-"));
  await mkdir(path.join(root, "Ideas", "Gift"), { recursive: true });
  await mkdir(path.join(root, "assets"), { recursive: true });
  await writeFile(path.join(root, "Ideas", "Gift", "peacock.webp"), "beside");
  await writeFile(path.join(root, "assets", "logo.png"), "attachments");
  await writeFile(path.join(root, "Ideas", "deep.png"), "elsewhere");
  return root;
}

describe("finding an embedded image", () => {
  it("looks beside the doc first, as Obsidian does", async () => {
    const root = await folder();
    expect(await findImage(root, "peacock.webp", "Ideas/Gift/Box.md")).toBe(
      "Ideas/Gift/peacock.webp",
    );
  });

  it("then the folder's attachments folder, from Obsidian's own setting", async () => {
    const root = await folder();
    await mkdir(path.join(root, ".obsidian"));
    await writeFile(
      path.join(root, ".obsidian", "app.json"),
      JSON.stringify({ attachmentFolderPath: "assets" }),
    );
    expect(await findImage(root, "logo.png", "Ideas/Gift/Box.md")).toBe("assets/logo.png");
  });

  it("then by its name anywhere in the folder", async () => {
    const root = await folder();
    expect(await findImage(root, "deep.png", "Notes/Other.md")).toBe("Ideas/deep.png");
    expect(await findImage(root, "missing.png", "Notes/Other.md")).toBeNull();
  });

  it("never leaves the folder, and reads only images", async () => {
    const root = await folder();
    expect(await findImage(root, "../../etc/hosts.png", "Ideas/Gift/Box.md")).toBeNull();
    expect(await findImage(root, "Box.md", "Ideas/Gift/Box.md")).toBeNull();
  });

  it("reads the file as a data URL, with %20 in a Markdown path decoded", async () => {
    const root = await folder();
    await writeFile(path.join(root, "Ideas", "Gift", "my photo.png"), "png");
    expect(await readImage(root, "my%20photo.png", "Ideas/Gift/Box.md")).toEqual({
      kind: "image",
      path: "Ideas/Gift/my photo.png",
      dataUrl: `data:image/png;base64,${Buffer.from("png").toString("base64")}`,
    });
    expect((await readImage(root, "https://example.com/a.png", "x.md")).kind).toBe("failed");
  });
});

describe("keeping a pasted image", () => {
  it("names it as Obsidian does, puts it where Obsidian would, and never overwrites", async () => {
    const root = await folder();
    const { saveImage, pastedName } = await import("./images.ts");
    expect(pastedName("image/png", new Date(2026, 10, 17, 14, 30, 5))).toBe(
      "Pasted image 20261117143005.png",
    );
    const a = await saveImage(root, "Ideas/Gift/Box.md", "", "image/png", Buffer.from("one"));
    expect(a.kind === "saved" && a.path).toMatch(/^Pasted image \d{14}\.png$/);
    await mkdir(path.join(root, ".obsidian"), { recursive: true });
    await writeFile(
      path.join(root, ".obsidian", "app.json"),
      JSON.stringify({ attachmentFolderPath: "./" }),
    );
    const b = await saveImage(
      root,
      "Ideas/Gift/Box.md",
      "shot.png",
      "image/png",
      Buffer.from("two"),
    );
    const c = await saveImage(
      root,
      "Ideas/Gift/Box.md",
      "shot.png",
      "image/png",
      Buffer.from("three"),
    );
    expect(b).toEqual({ kind: "saved", path: "Ideas/Gift/shot.png", name: "shot.png" });
    expect(c).toEqual({ kind: "saved", path: "Ideas/Gift/shot 1.png", name: "shot 1.png" });
    expect(
      (await saveImage(root, "x.md", "a.exe", "application/x-msdownload", Buffer.from("x"))).kind,
    ).toBe("failed");
  });
});
