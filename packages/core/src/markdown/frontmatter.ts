import type { Input } from "@lezer/common";
import type { BlockContext, MarkdownConfig } from "@lezer/markdown";
import { styleTags, tags } from "@lezer/highlight";

/**
 * YAML frontmatter, read the way Obsidian reads it: a `---` line as the
 * file's very first line, closed by the next `---` line. Without a closing
 * line it is not frontmatter, and the `---` stays a horizontal rule.
 *
 * Frontmatter belongs to the file and is never a section (Data Model).
 */
const FENCE = /^---[ \t]*$/;

/**
 * The block context keeps the parse input but does not type it. We need it to
 * look ahead for the closing line before consuming anything, so an unclosed
 * `---` never swallows the doc. @lezer/markdown is pinned to an exact
 * version, and the frontmatter tests fail loudly if this ever changes.
 */
export function inputOf(cx: BlockContext): Input {
  const input = (cx as unknown as { input?: Input }).input;
  if (!input || typeof input.read !== "function") {
    throw new Error("@lezer/markdown changed: BlockContext.input is gone");
  }
  return input;
}

/** The start of the closing `---` line, or -1 when there is none. */
function findClosingLine(text: string): number {
  let lineStart = text.indexOf("\n") + 1;
  while (lineStart > 0 && lineStart < text.length) {
    const nl = text.indexOf("\n", lineStart);
    const line = text.slice(lineStart, nl < 0 ? text.length : nl);
    if (FENCE.test(line.replace(/\r$/, ""))) return lineStart;
    if (nl < 0) break;
    lineStart = nl + 1;
  }
  return -1;
}

export const Frontmatter: MarkdownConfig = {
  defineNodes: [
    { name: "Frontmatter", block: true },
    { name: "FrontmatterMark" },
    { name: "FrontmatterContent" },
  ],
  props: [
    styleTags({
      Frontmatter: tags.meta,
      FrontmatterMark: tags.processingInstruction,
    }),
  ],
  parseBlock: [
    {
      name: "Frontmatter",
      before: "HorizontalRule",
      parse(cx, line) {
        if (cx.lineStart !== 0 || !FENCE.test(line.text.replace(/\r$/, ""))) return false;
        const input = inputOf(cx);
        const text = input.read(0, input.length);
        const close = findClosingLine(text);
        if (close < 0) return false;

        const openEnd = 3;
        const contentFrom = text.indexOf("\n") + 1;
        const contentTo = Math.max(contentFrom, close - 1);
        const closeEnd = close + 3;

        while (cx.lineStart < close) {
          if (!cx.nextLine()) break;
        }
        cx.nextLine(); // past the closing line

        const children = [cx.elt("FrontmatterMark", 0, openEnd)];
        if (contentTo > contentFrom) {
          children.push(cx.elt("FrontmatterContent", contentFrom, contentTo));
        }
        children.push(cx.elt("FrontmatterMark", close, closeEnd));
        cx.addElement(cx.elt("Frontmatter", 0, closeEnd, children));
        return true;
      },
    },
  ],
};
