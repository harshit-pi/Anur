import { describe, expect, it } from "vitest";
import { feedBlock, gather, noteOf, notesFrom } from "./release-notes.ts";

const body = (note: string) =>
  `## What changes, and why\n\nStuff.\n\n## Release note\n\n<!-- One line -->\n${note}\n\n## How it was checked\n\n- [x] ok\n`;

describe("release notes", () => {
  it("reads a PR's note, its 'none', or that it has none", () => {
    expect(noteOf(body("Drawings show on the page."))).toBe("Drawings show on the page.");
    expect(noteOf(body("none"))).toBe("none");
    expect(noteOf(body(""))).toBeNull();
    expect(noteOf("## What changes\n\nNo note section.")).toBeNull();
  });

  it("gathers a release's notes and names the PRs missing one", () => {
    const r = gather([
      { number: 1, title: "Drawings", body: body("Drawings show on the page") },
      { number: 2, title: "Refactor", body: body("none") },
      { number: 3, title: "Search", body: "## What changes\n\nNo note." },
    ]);
    expect(r.notes).toEqual(["Drawings show on the page."]);
    expect(r.missing).toEqual([{ number: 3, title: "Search" }]);
  });

  it("round-trips through the update feed", () => {
    const block = feedBlock(["One.", "Two."]);
    expect(block).toBe("releaseNotes: |-\n  - One.\n  - Two.\n");
    expect(notesFrom("- One.\n- Two.")).toEqual(["One.", "Two."]);
    expect(notesFrom("<ul><li>One.</li><li>Two.</li></ul>")).toEqual(["One.", "Two."]);
  });
});
