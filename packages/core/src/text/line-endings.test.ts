import { describe, expect, it } from "vitest";
import { applyEol, detectEol, normalizeEol } from "./line-endings.ts";

describe("line endings", () => {
  it.each([
    ["a\nb\n", "\n", false],
    ["a\r\nb\r\n", "\r\n", false],
    ["a\rb\r", "\r", false],
    ["no breaks", "\n", false],
    ["a\r\nb\r\nc\n", "\r\n", true],
    ["a\nb\nc\r\n", "\n", true],
    ["a\nb\r\n", "\n", true],
  ])("%j is written with %j, mixed: %s", (text, eol, mixed) => {
    expect(detectEol(text)).toMatchObject({ eol, mixed });
  });

  it("round-trips a file with one kind of ending exactly", () => {
    for (const text of [
      "# T\r\n\r\nBody.\r\n",
      "# T\n\nBody.\n",
      "# T\rBody\r",
      "no newline at end\r\nlast",
    ]) {
      const { eol } = detectEol(text);
      expect(applyEol(normalizeEol(text), eol)).toBe(text);
    }
  });

  it("writes a mixed file with its most common ending", () => {
    const text = "a\r\nb\r\nc\n";
    expect(applyEol(normalizeEol(text), detectEol(text).eol)).toBe("a\r\nb\r\nc\r\n");
  });
});
