import { describe, expect, it } from "vitest";
import { headingKey, resolveHref, resolveWiki } from "./links.ts";

const DOCS = [
  "Ideas/Agent/Debate.md",
  "Ideas/Agent/Notes.md",
  "Ideas/Notes.md",
  "Archive/Old/Debate.md",
  "Personas.md",
];

describe("a wiki link", () => {
  it("finds a doc by name anywhere in the folder", () => {
    expect(resolveWiki(DOCS, "Ideas/Agent/Debate.md", "Personas", null)).toEqual({
      kind: "doc",
      path: "Personas.md",
      heading: null,
    });
  });

  it("prefers the linking doc's own folder when names clash", () => {
    expect(resolveWiki(DOCS, "Ideas/Agent/Debate.md", "Notes", null)).toMatchObject({
      path: "Ideas/Agent/Notes.md",
    });
    expect(resolveWiki(DOCS, "Personas.md", "Notes", null)).toMatchObject({
      path: "Ideas/Notes.md",
    });
  });

  it("follows a path when the link gives one, and ignores case and .md", () => {
    expect(resolveWiki(DOCS, "Personas.md", "Archive/Old/Debate", "Round 2")).toEqual({
      kind: "doc",
      path: "Archive/Old/Debate.md",
      heading: "Round 2",
    });
    expect(resolveWiki(DOCS, "Personas.md", "personas.md", null)).toMatchObject({
      path: "Personas.md",
    });
  });

  it("points at this doc when it names only a heading", () => {
    expect(resolveWiki(DOCS, "Personas.md", "", "Solo")).toEqual({
      kind: "doc",
      path: "Personas.md",
      heading: "Solo",
    });
  });

  it("says when no doc has that name", () => {
    expect(resolveWiki(DOCS, "Personas.md", "Nowhere", null)).toEqual({
      kind: "missing",
      name: "Nowhere",
    });
  });
});

describe("a Markdown link", () => {
  it("leaves the app for the web and mail", () => {
    expect(resolveHref(DOCS, "Personas.md", "https://example.com/a")).toEqual({
      kind: "web",
      url: "https://example.com/a",
    });
    expect(resolveHref(DOCS, "Personas.md", "mailto:a@b.co").kind).toBe("web");
    expect(resolveHref(DOCS, "Personas.md", "file:///etc/hosts").kind).toBe("missing");
  });

  it("follows a path relative to the linking doc", () => {
    expect(resolveHref(DOCS, "Ideas/Agent/Debate.md", "Notes.md")).toMatchObject({
      path: "Ideas/Agent/Notes.md",
    });
    expect(resolveHref(DOCS, "Ideas/Agent/Debate.md", "../Notes.md#Open%20questions")).toEqual({
      kind: "doc",
      path: "Ideas/Notes.md",
      heading: "Open questions",
    });
    expect(resolveHref(DOCS, "Ideas/Agent/Debate.md", "../../Archive/Old/Debate")).toMatchObject({
      path: "Archive/Old/Debate.md",
    });
  });
});

describe("heading names", () => {
  it("match however the link spells them", () => {
    expect(headingKey("Who it's for")).toBe(headingKey("who  it's FOR"));
    expect(headingKey("Round 2: results")).toBe(headingKey("Round 2 results"));
  });
});
