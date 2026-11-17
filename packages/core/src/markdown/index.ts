import { GFM, parser as commonmark, type MarkdownExtension } from "@lezer/markdown";
import { Frontmatter } from "./frontmatter.ts";
import { WikiLinks } from "./wikilink.ts";

/**
 * The one Markdown configuration Anur uses everywhere: GitHub-flavoured
 * Markdown, Obsidian wiki links and frontmatter. The editor passes
 * `markdownExtensions` to CodeMirror's `markdown()`, and everything else
 * parses with `markdownParser`, so the page and the index always agree on
 * sections (Architecture, Stack).
 */
export const markdownExtensions: MarkdownExtension = [GFM, Frontmatter, WikiLinks];

export const markdownParser = commonmark.configure(markdownExtensions);

export { readWikiLink, type WikiLink } from "./wikilink.ts";
