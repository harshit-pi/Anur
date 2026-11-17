import { describe, expect, it } from "vitest";
import { crumbs, folderMenu, wikiLinkTo } from "./path-row.ts";

const DOCS = [
  "Ideas/Agent/Debate.md",
  "Ideas/Agent/Notes.md",
  "Ideas/Other.md",
  "Ideas/Deep/A/x.md",
  "Top.md",
];

describe("the path row", () => {
  it("splits a doc's path into segments, each listing its folder", () => {
    expect(crumbs("Ideas/Agent/Debate.md")).toEqual([
      { label: "Ideas", lists: "Ideas" },
      { label: "Agent", lists: "Ideas/Agent" },
      { label: "Debate", lists: "Ideas/Agent" },
    ]);
  });

  it("lists a folder's direct contents, folders as submenus first", () => {
    expect(folderMenu(DOCS, "Ideas", "Ideas/Other.md")).toEqual([
      {
        label: "Agent",
        submenu: [
          { id: "doc:Ideas/Agent/Debate.md", label: "Debate", checked: false },
          { id: "doc:Ideas/Agent/Notes.md", label: "Notes", checked: false },
        ],
      },
      {
        label: "Deep",
        submenu: [
          { label: "A", submenu: [{ id: "doc:Ideas/Deep/A/x.md", label: "x", checked: false }] },
        ],
      },
      { id: "doc:Ideas/Other.md", label: "Other", checked: true },
    ]);
    expect(folderMenu(DOCS, "Missing", null)).toEqual([]);
  });

  it("writes a link as Obsidian does: by name, or by path when names clash", () => {
    expect(wikiLinkTo(DOCS, "Ideas/Agent/Debate.md", "Scoreboard")).toBe("[[Debate#Scoreboard]]");
    expect(wikiLinkTo(DOCS, "Top.md", null)).toBe("[[Top]]");
    const clash = [...DOCS, "Elsewhere/Debate.md"];
    expect(wikiLinkTo(clash, "Ideas/Agent/Debate.md", null)).toBe("[[Ideas/Agent/Debate]]");
  });
});
