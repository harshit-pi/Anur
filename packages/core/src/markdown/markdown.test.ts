import { describe, expect, it } from "vitest";
import { markdownParser, readWikiLink } from "./index.ts";

/** Every node of a given type, as the source text it covers. */
function nodes(doc: string, name: string): string[] {
  const out: string[] = [];
  markdownParser.parse(doc).iterate({
    enter(n) {
      if (n.name === name) out.push(doc.slice(n.from, n.to));
    },
  });
  return out;
}

const headings = (doc: string) => [
  ...nodes(doc, "ATXHeading1"),
  ...nodes(doc, "ATXHeading2"),
  ...nodes(doc, "SetextHeading2"),
];

describe("GitHub-flavoured Markdown", () => {
  it("parses tables, task lists, strikethrough and bare URLs", () => {
    const doc = [
      "| a | b |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "- [ ] open",
      "- [x] done",
      "",
      "~~gone~~ and https://example.com",
    ].join("\n");
    expect(nodes(doc, "Table")).toHaveLength(1);
    expect(nodes(doc, "Task")).toHaveLength(2);
    expect(nodes(doc, "Strikethrough")).toEqual(["~~gone~~"]);
    expect(nodes(doc, "URL")).toContain("https://example.com");
  });

  it("does not see headings inside fenced code", () => {
    const doc = "# Title\n\n```md\n## Not a heading\n```\n\n## Real\n";
    expect(headings(doc)).toEqual(["# Title", "## Real"]);
  });
});

describe("frontmatter", () => {
  it("is one node at the top, and the heading after it is still a heading", () => {
    const doc = "---\ntitle: Retry\ntags: [a]\n---\n# Title\n";
    expect(nodes(doc, "Frontmatter")).toEqual(["---\ntitle: Retry\ntags: [a]\n---"]);
    expect(nodes(doc, "FrontmatterContent")).toEqual(["title: Retry\ntags: [a]"]);
    expect(headings(doc)).toEqual(["# Title"]);
  });

  it("is not a setext heading or a rule", () => {
    const doc = "---\ntitle: x\n---\n\ntext\n";
    expect(nodes(doc, "SetextHeading2")).toEqual([]);
    expect(nodes(doc, "HorizontalRule")).toEqual([]);
  });

  it("can be empty", () => {
    expect(nodes("---\n---\n# T\n", "Frontmatter")).toEqual(["---\n---"]);
  });

  it("without a closing line stays a rule and swallows nothing", () => {
    const doc = "---\n# Title\n\n## Section\n";
    expect(nodes(doc, "Frontmatter")).toEqual([]);
    expect(nodes(doc, "HorizontalRule")).toEqual(["---"]);
    expect(headings(doc)).toEqual(["# Title", "## Section"]);
  });

  it("only counts on the very first line", () => {
    const doc = "\n---\ntitle: x\n---\n";
    expect(nodes(doc, "Frontmatter")).toEqual([]);
    expect(nodes("# T\n\n---\na: b\n---\n", "Frontmatter")).toEqual([]);
  });

  it("handles Windows line endings", () => {
    expect(nodes("---\r\ntitle: x\r\n---\r\n# T\r\n", "Frontmatter")).toHaveLength(1);
  });
});

describe("wiki links", () => {
  it("parses target, heading and alias", () => {
    const doc = "See [[Design - Context#How a turn is built|§ Turn]].";
    expect(nodes(doc, "WikiLink")).toEqual(["[[Design - Context#How a turn is built|§ Turn]]"]);
    expect(nodes(doc, "WikiLinkTarget")).toEqual(["Design - Context"]);
    expect(nodes(doc, "WikiLinkHeading")).toEqual(["How a turn is built"]);
    expect(nodes(doc, "WikiLinkAlias")).toEqual(["§ Turn"]);
  });

  it("parses a link within the same file", () => {
    const doc = "[[#Retry timing]]";
    expect(nodes(doc, "WikiLinkTarget")).toEqual([]);
    expect(nodes(doc, "WikiLinkHeading")).toEqual(["Retry timing"]);
  });

  it("parses embeds separately from links", () => {
    const doc = "![[Mock 5 - Preview in doc.png]] and [[Notes]]";
    expect(nodes(doc, "WikiEmbed")).toEqual(["![[Mock 5 - Preview in doc.png]]"]);
    expect(nodes(doc, "WikiLink")).toEqual(["[[Notes]]"]);
    expect(nodes(doc, "Image")).toEqual([]);
  });

  it("reads the escaped bar Obsidian writes inside table cells", () => {
    const doc = "| Page |\n| - |\n| [[Design - Context\\|§ Context]] |\n";
    expect(nodes(doc, "WikiLinkTarget")).toEqual(["Design - Context"]);
    expect(nodes(doc, "WikiLinkAlias")).toEqual(["§ Context"]);
  });

  it("ignores code, empty and unclosed links, and keeps ordinary links", () => {
    expect(nodes("`[[Not a link]]`", "WikiLink")).toEqual([]);
    expect(nodes("```\n[[Not a link]]\n```", "WikiLink")).toEqual([]);
    expect(nodes("[[]] and [[ ]]", "WikiLink")).toEqual([]);
    expect(nodes("[[unclosed and more", "WikiLink")).toEqual([]);
    expect(nodes("[[a\nb]]", "WikiLink")).toEqual([]);
    expect(nodes("[text](https://example.com)", "Link")).toHaveLength(1);
  });

  it("reads a link's parts from its source", () => {
    expect(readWikiLink("[[A#B#C|alias]]")).toEqual({
      target: "A",
      heading: "B#C",
      alias: "alias",
      embed: false,
    });
    expect(readWikiLink("![[img.png]]")).toEqual({
      target: "img.png",
      heading: null,
      alias: null,
      embed: true,
    });
    expect(readWikiLink("[[Doc\\|Short]]")).toEqual({
      target: "Doc",
      heading: null,
      alias: "Short",
      embed: false,
    });
    expect(readWikiLink("[[a]b]]")).toBeNull();
    expect(readWikiLink("[not]")).toBeNull();
  });
});

describe("Obsidian syntax kept as text", () => {
  it("parses comments, highlights and callouts without losing text", () => {
    const doc = "%% hidden %%\n\n==marked==\n\n> [!note] Title\n> body\n";
    const tree = markdownParser.parse(doc);
    expect(tree.length).toBe(doc.length);
    expect(nodes(doc, "Blockquote")).toHaveLength(1);
  });
});
