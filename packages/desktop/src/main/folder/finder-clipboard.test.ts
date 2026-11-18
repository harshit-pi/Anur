import { describe, expect, it } from "vitest";
import { filePathsPlist, readFilePaths } from "./finder-clipboard.ts";

describe("Finder's file clipboard", () => {
  it("reads back the paths it writes, odd characters and all", () => {
    const paths = ["/Users/me/A & B.md", "/Users/me/<draft>.md", "/tmp/plain.png"];
    expect(readFilePaths(filePathsPlist(paths), "")).toEqual(paths);
  });

  it("falls back to file URLs, ignoring other links", () => {
    expect(
      readFilePaths("", "file:///Users/me/My%20Doc.md\r\nhttps://example.com\nfile:///tmp/a.png"),
    ).toEqual(["/Users/me/My Doc.md", "/tmp/a.png"]);
  });

  it("finds nothing on a clipboard of text", () => {
    expect(readFilePaths("", "")).toEqual([]);
  });
});
