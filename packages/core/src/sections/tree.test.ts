import { describe, expect, it } from "vitest";
import { DocId, Section, SectionId, formatPath, ownText, subtreeText } from "./section.ts";
import { buildSectionTree, toSectionRecords, type SectionTree } from "./tree.ts";

const build = (doc: string, fileName = "notes.md") => buildSectionTree(doc, { fileName });
const paths = (t: SectionTree) => t.sections.map((s) => formatPath(s.path));

/**
 * Every character of the body belongs to exactly one section's own text, and
 * a subtree is its own text followed by its children's subtrees.
 */
function expectCovers(doc: string, t: SectionTree) {
  const own = t.sections.map((s) => ownText(doc, s)).join("");
  expect(own).toBe(doc.slice(t.body.from));
  for (const s of t.sections) {
    const parts = [ownText(doc, s), ...s.children.map((c) => subtreeText(doc, t.sections[c] ?? s))];
    expect(parts.join("")).toBe(subtreeText(doc, s));
  }
}

const DOC = [
  "# Failed-payment notifications",
  "",
  "Notify customers when a card payment fails.",
  "",
  "## Retry timing",
  "",
  "Retry after 1 hour. See [[#Notification channel]].",
  "",
  "### Notes",
  "",
  "First notes.",
  "",
  "### Notes",
  "",
  "Second notes.",
  "",
  "## Notification channel",
  "",
  "Email first; see [[notes#Retry timing|timing]] and [[Other doc#Rollout]].",
  "",
].join("\n");

describe("the section tree", () => {
  it("nests sections by level under the title", () => {
    const t = build(DOC);
    expect(paths(t)).toEqual([
      "Failed-payment notifications",
      "Failed-payment notifications > Retry timing",
      "Failed-payment notifications > Retry timing > Notes",
      "Failed-payment notifications > Retry timing > Notes",
      "Failed-payment notifications > Notification channel",
    ]);
    expect(t.sections.map((s) => s.level)).toEqual([1, 2, 3, 3, 2]);
    expect(t.sections.map((s) => s.order)).toEqual([0, 0, 0, 1, 1]);
    expect(t.sections[0]?.children).toEqual([1, 4]);
    expectCovers(DOC, t);
  });

  it("tells two same-named headings apart by ordinal", () => {
    const t = build(DOC);
    expect(t.sections.map((s) => s.ordinal)).toEqual([0, 0, 0, 1, 0]);
  });

  it("gives the title the text before the first other heading", () => {
    const t = build(DOC);
    const title = t.sections[0];
    if (!title) throw new Error("no title section");
    expect(ownText(DOC, title)).toContain("Notify customers");
    expect(t.sections[0]?.headingRange).toEqual({
      from: 0,
      to: "# Failed-payment notifications".length,
    });
  });

  it("names a doc with no H1 after its file, with no heading", () => {
    const doc = "Some intro.\n\n## First\n\nText.\n";
    const t = build(doc, "folder/Plan v2.md");
    expect(paths(t)).toEqual(["Plan v2", "Plan v2 > First"]);
    expect(t.sections[0]?.headingRange).toBeNull();
    expectCovers(doc, t);
  });

  it("treats an H1 after text as a section, not the title", () => {
    const doc = "Intro first.\n\n# Big heading\n\nText.\n";
    const t = build(doc, "a.md");
    expect(paths(t)).toEqual(["a", "a > Big heading"]);
    expect(t.sections[1]?.level).toBe(1);
    expectCovers(doc, t);
  });

  it("leaves frontmatter out of every section", () => {
    const doc = "---\ntitle: x\n---\n\n# Title\n\n## A\n\nText.\n";
    const t = build(doc);
    expect(t.frontmatter).toEqual({ from: 0, to: "---\ntitle: x\n---".length });
    expect(paths(t)).toEqual(["Title", "Title > A"]);
    expect(t.sections[0]?.ownRange.from).toBe(doc.indexOf("# Title"));
    for (const s of t.sections) expect(ownText(doc, s)).not.toContain("title: x");
    expectCovers(doc, t);
  });

  it("nests a later H1 under the title", () => {
    const doc = "# Title\n\n## A\n\n# Second part\n\n## B\n";
    const t = build(doc);
    expect(paths(t)).toEqual([
      "Title",
      "Title > A",
      "Title > Second part",
      "Title > Second part > B",
    ]);
    expectCovers(doc, t);
  });

  it("nests skipped levels under the nearest heading above", () => {
    const doc = "# T\n\n## A\n\n#### Deep\n\n### Mid\n\n## B\n";
    const t = build(doc);
    expect(paths(t)).toEqual(["T", "T > A", "T > A > Deep", "T > A > Mid", "T > B"]);
    expectCovers(doc, t);
  });

  it("ignores headings in code, quotes and callouts, and reads setext headings", () => {
    const doc =
      "# T\n\n```\n## code\n```\n\n> ## quoted\n\n> [!note]\n> ## callout\n\nSetext\n------\n\nText.\n";
    const t = build(doc);
    expect(paths(t)).toEqual(["T", "T > Setext"]);
    expectCovers(doc, t);
  });

  it("strips heading marks and keeps the text as written", () => {
    const doc = "# T #\n\n##   **Bold**  heading ##\n";
    expect(paths(build(doc))).toEqual(["T", "T > **Bold** heading"]);
  });

  it("handles an empty doc and Windows line endings", () => {
    const empty = build("");
    expect(paths(empty)).toEqual(["notes"]);
    expect(empty.sections[0]?.ownRange).toEqual({ from: 0, to: 0 });
    const crlf = "# T\r\n\r\n## A\r\n\r\nText.\r\n";
    const t = build(crlf);
    expect(paths(t)).toEqual(["T", "T > A"]);
    expectCovers(crlf, t);
  });
});

describe("links within the doc", () => {
  it("resolves same-doc links and leaves other docs for the index", () => {
    const t = build(DOC, "notes.md");
    const [retry, channel] = [t.sections[1], t.sections[4]];
    expect(retry?.linksOut.map((l) => [l.heading, l.targetIndex])).toEqual([
      ["Notification channel", 4],
    ]);
    expect(channel?.linksOut.map((l) => [l.target, l.heading, l.sameDoc, l.targetIndex])).toEqual([
      ["notes", "Retry timing", true, 1],
      ["Other doc", "Rollout", false, null],
    ]);
  });

  it("resolves nested headings, falls back to case, and skips block refs", () => {
    const doc =
      "# T\n\n## A\n\n### Notes\n\n## B\n\n### Notes\n\n[[#B#Notes]] [[#retry]] [[#^abc]] [[#Missing]]\n\n## Retry\n";
    const t = build(doc);
    const links = t.sections.flatMap((s) => s.linksOut).map((l) => l.targetIndex);
    const bNotes = t.sections.findIndex((s) => formatPath(s.path) === "T > B > Notes");
    const retry = t.sections.findIndex((s) => formatPath(s.path) === "T > Retry");
    expect(links).toEqual([bNotes, retry, null, null]);
  });

  it("puts each link in the section whose own text holds it", () => {
    const t = build(DOC);
    for (const s of t.sections) {
      for (const l of s.linksOut) {
        expect(l.range.from).toBeGreaterThanOrEqual(s.ownRange.from);
        expect(l.range.to).toBeLessThanOrEqual(s.ownRange.to);
      }
    }
  });
});

describe("section records", () => {
  it("turns the tree into valid records with links resolved to IDs", () => {
    const t = build(DOC, "notes.md");
    const ids = t.sections.map((_, i) => SectionId.parse(`s${String(i)}`));
    const records = toSectionRecords(t, DocId.parse("d1"), ids);
    for (const r of records) expect(Section.safeParse(r).success).toBe(true);
    expect(records[1]?.linksOut[0]?.resolved).toBe("s4");
    expect(records[4]?.linksIn).toEqual(["s1"]);
    expect(records[1]?.linksIn).toEqual(["s4"]);
    expect(records[4]?.linksOut[1]?.resolved).toBeNull();
  });

  it("needs one ID per section", () => {
    const t = build(DOC);
    expect(() => toSectionRecords(t, DocId.parse("d1"), [])).toThrow();
  });
});
