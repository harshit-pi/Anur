import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PLAIN_TEXT_BYTES, decodeDoc, encodeDoc, readDoc, writeDoc } from "./doc-file.ts";

const utf8 = (s: string) => new TextEncoder().encode(s);
const BOM = [0xef, 0xbb, 0xbf];
const withBom = (s: string) => new Uint8Array([...BOM, ...utf8(s)]);

/** Decode and encode again without editing: the bytes must not change. */
const roundTrip = (bytes: Uint8Array) => {
  const doc = decodeDoc(bytes);
  return encodeDoc(doc.text, doc);
};

describe("a doc's bytes", () => {
  it.each([
    ["Unix endings", utf8("# T\n\n## A\n\nText.\n")],
    ["Windows endings", utf8("# T\r\n\r\n## A\r\n\r\nText.\r\n")],
    ["old Mac endings", utf8("# T\r\rText.\r")],
    ["no newline at the end", utf8("# T\r\n\r\nlast line")],
    ["a byte-order mark", withBom("# T\r\n\r\nText.\r\n")],
    ["an empty file", utf8("")],
    [
      "Obsidian comments, callouts and embeds",
      utf8("%% hidden %%\n\n> [!note] Title\n> body\n\n![[Mock.png]]\n==marked==\n"),
    ],
    ["non-Latin text and emoji", utf8("# Café 東京 🚀\n\nÜber.\n")],
  ])("come back unchanged: %s", (_, bytes) => {
    expect(roundTrip(bytes)).toEqual(bytes);
  });

  it('give the editor "\\n" endings, whatever the file uses', () => {
    expect(decodeDoc(utf8("a\r\nb\r\n")).text).toBe("a\nb\n");
    expect(decodeDoc(withBom("a\r\n")).text).toBe("a\n");
  });

  it("write a mixed file with its most common ending, and say so", () => {
    const doc = decodeDoc(utf8("a\r\nb\r\nc\n"));
    expect(doc).toMatchObject({ eol: "\r\n", mode: "editable" });
    expect(doc.note).toMatch(/mixes line endings.*Windows \(CRLF\)/);
    expect(new TextDecoder().decode(encodeDoc(doc.text, doc))).toBe("a\r\nb\r\nc\r\n");
  });

  it("open a file that isn't UTF-8 read-only", () => {
    const latin1 = new Uint8Array([0x23, 0x20, 0x43, 0x61, 0x66, 0xe9, 0x0a]); // "# Café" in Latin-1
    expect(decodeDoc(latin1)).toMatchObject({ mode: "read-only" });
    expect(decodeDoc(latin1).note).toMatch(/isn't UTF-8/);
    const utf16 = new Uint8Array([0xff, 0xfe, 0x23, 0x00]);
    expect(decodeDoc(utf16).mode).toBe("read-only");
  });

  it("open a file over 5 MB as plain text", () => {
    const big = utf8(`# Big\n\n${"x".repeat(PLAIN_TEXT_BYTES)}\n`);
    expect(decodeDoc(big)).toMatchObject({ mode: "plain-text" });
    expect(decodeDoc(utf8("# Small\n")).mode).toBe("editable");
  });
});

describe("on disk", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "anur-docfile-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes an edit back with the file's own endings and byte-order mark", async () => {
    const file = path.join(dir, "doc.md");
    writeFileSync(file, withBom("# T\r\n\r\nOld.\r\n"));
    const doc = await readDoc(file);
    await writeDoc(file, doc.text.replace("Old.", "New."), doc);
    expect(readFileSync(file)).toEqual(Buffer.from(withBom("# T\r\n\r\nNew.\r\n")));
  });

  it("refuses to write a file it opened read-only", async () => {
    const file = path.join(dir, "latin1.md");
    const bytes = Buffer.from([0x43, 0x61, 0x66, 0xe9, 0x0a]);
    writeFileSync(file, bytes);
    const doc = await readDoc(file);
    await expect(writeDoc(file, "changed", doc)).rejects.toThrow(/read-only/);
    expect(readFileSync(file)).toEqual(bytes);
  });
});
