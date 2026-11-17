import { describe, expect, it } from "vitest";
import { isDownloaded, markDownloaded, noneDownloaded, withDownloaded } from "./downloaded.ts";

const folder = { path: "/Vault", offloaded: ["a.md", "b.md"] };

describe("docs downloaded since the folder was listed", () => {
  it("stop being shown as cloud-only once opened", () => {
    const d = markDownloaded(noneDownloaded, "/Vault", "a.md");
    expect(isDownloaded(d, "/Vault", "a.md")).toBe(true);
    expect(withDownloaded(folder, d).offloaded).toEqual(["b.md"]);
  });

  it("leave the folder untouched when nothing changed", () => {
    expect(withDownloaded(folder, noneDownloaded)).toBe(folder);
    const d = markDownloaded(noneDownloaded, "/Vault", "c.md");
    expect(withDownloaded(folder, d)).toBe(folder);
  });

  it("start over in another folder", () => {
    const d = markDownloaded(markDownloaded(noneDownloaded, "/Vault", "a.md"), "/Other", "a.md");
    expect(isDownloaded(d, "/Vault", "a.md")).toBe(false);
    expect(withDownloaded(folder, d)).toBe(folder);
  });

  it("keep the same set when a doc is marked twice", () => {
    const d = markDownloaded(noneDownloaded, "/Vault", "a.md");
    expect(markDownloaded(d, "/Vault", "a.md")).toBe(d);
  });
});
