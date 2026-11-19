import { describe, expect, it } from "vitest";
import { SectionId } from "../sections/section.ts";
import { buildSectionTree } from "../sections/tree.ts";
import { hasConflictMarkers, matchSections, sectionBodies, similarity } from "./matcher.ts";

/** A doc's sections, with IDs named after their paths so the expectations read plainly. */
function old(doc: string) {
  const tree = buildSectionTree(doc, { fileName: "doc.md" });
  const bodies = sectionBodies(doc, tree);
  return tree.sections.map((s, i) => ({
    id: SectionId.parse(
      s.path
        .join("-")
        .replace(/[^A-Za-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") + (s.ordinal ? `-${String(s.ordinal)}` : ""),
    ),
    path: s.path,
    body: bodies[i] ?? "",
  }));
}
function next(doc: string) {
  const tree = buildSectionTree(doc, { fileName: "doc.md" });
  const bodies = sectionBodies(doc, tree);
  return tree.sections.map((s, i) => ({ path: s.path, body: bodies[i] ?? "" }));
}

const BEFORE = [
  "# Plan",
  "",
  "## Retry timing",
  "",
  "Retry after one hour, then after twenty four hours, then stop.",
  "",
  "### Notes",
  "",
  "Banks decline more on weekends.",
  "",
  "### Notes",
  "",
  "Customers want an email first.",
  "",
  "## Channel",
  "",
  "Email first, SMS when the email bounces.",
  "",
].join("\n");

describe("the matcher", () => {
  it("keeps every ID when nothing changed", () => {
    const r = matchSections(old(BEFORE), next(BEFORE));
    expect(r.carried).toEqual(old(BEFORE).map((s) => s.id));
    expect(r.how).toEqual(["path", "path", "path", "path", "path"]);
    expect(r.orphans).toEqual([]);
  });

  it("follows a heading renamed in another editor, by its text", () => {
    const after = BEFORE.replace("## Retry timing", "## Retry schedule");
    const r = matchSections(old(BEFORE), next(after));
    expect(r.carried[1]).toBe("Plan-Retry-timing");
    expect(r.how[1]).toBe("text");
    expect(r.carried[2]).toBe("Plan-Retry-timing-Notes");
    expect(r.how[2]).toBe("heading");
  });

  it("follows a section moved under another parent, by its heading text", () => {
    const after = BEFORE.replace(
      "## Channel\n\nEmail first, SMS when the email bounces.\n",
      "",
    ).replace(
      "### Notes\n\nBanks",
      "### Channel\n\nEmail first, SMS when the email bounces.\n\n### Notes\n\nBanks",
    );
    const r = matchSections(old(BEFORE), next(after));
    const moved = next(after).findIndex(
      (s) => s.path.join(" > ") === "Plan > Retry timing > Channel",
    );
    expect(r.carried[moved]).toBe("Plan-Channel");
    expect(r.how[moved]).toBe("heading");
  });

  it("tells two same-named headings apart by their text when they swap", () => {
    const after = BEFORE.replace("Banks decline more on weekends.", "@@")
      .replace("Customers want an email first.", "Banks decline more on weekends.")
      .replace("@@", "Customers want an email first.");
    const r = matchSections(old(BEFORE), next(after));
    expect(r.carried[2]).toBe("Plan-Retry-timing-Notes-1");
    expect(r.carried[3]).toBe("Plan-Retry-timing-Notes");
  });

  it("orphans a deleted section, suggesting the most similar one left", () => {
    const after = BEFORE.replace("## Channel\n\nEmail first, SMS when the email bounces.\n", "");
    const r = matchSections(old(BEFORE), next(after));
    // "Customers want an email first." shares "email" and "first".
    expect(r.orphans).toEqual([
      { id: "Plan-Channel", suggestion: 3, score: expect.any(Number) as number },
    ]);
  });

  it("gives an orphan no suggestion when nothing is like it", () => {
    const before = "# P\n\n## A\n\nalpha beta gamma\n\n## B\n\ndelta epsilon zeta\n";
    const r = matchSections(old(before), next("# P\n\n## A\n\nalpha beta gamma\n"));
    expect(r.orphans).toEqual([{ id: "P-B", suggestion: null, score: 0 }]);
  });

  it("orphans a section rewritten past the bar, suggesting the closest one", () => {
    const after = BEFORE.replace(
      "## Channel\n\nEmail first, SMS when the email bounces.",
      "## Delivery\n\nPhone calls first; SMS only if the account owner asks.",
    );
    const r = matchSections(old(BEFORE), next(after));
    const delivery = next(after).findIndex((s) => s.path.at(-1) === "Delivery");
    expect(r.carried[delivery]).toBeNull();
    expect(r.orphans).toEqual([
      { id: "Plan-Channel", suggestion: delivery, score: expect.any(Number) as number },
    ]);
  });

  it("keeps an ID through a rewrite that keeps most of the words", () => {
    const after = BEFORE.replace(
      "## Channel\n\nEmail first, SMS when the email bounces.",
      "## Delivery\n\nSMS when the email bounces; push later.",
    );
    const r = matchSections(old(BEFORE), next(after));
    const delivery = next(after).findIndex((s) => s.path.at(-1) === "Delivery");
    expect(r.carried[delivery]).toBe("Plan-Channel");
    expect(r.how[delivery]).toBe("text");
  });
});

describe("similarity", () => {
  it("is 1 for the same words, 0 for none shared, and ignores case and punctuation", () => {
    expect(similarity("Retry after one hour.", "retry AFTER one hour")).toBe(1);
    expect(similarity("alpha beta", "gamma delta")).toBe(0);
    expect(similarity("", "")).toBe(0);
  });
});

describe("conflict markers", () => {
  it("are seen only when all three are present", () => {
    expect(hasConflictMarkers("<<<<<<< HEAD\na\n=======\nb\n>>>>>>> main\n")).toBe(true);
    expect(hasConflictMarkers("Title\n=======\n")).toBe(false);
    expect(hasConflictMarkers("text with <<<<<<< inside\n")).toBe(false);
  });
});

describe("matching by place", () => {
  it("keeps the IDs of a renamed title and a renamed empty section", () => {
    const before = old("# Untitled\n\n## New section\n\n## Goal\n\nGrow funded accounts.\n");
    const after = next("# GTM\n\n## Channels\n\n## Goal\n\nGrow funded accounts.\n");
    const r = matchSections(before, after);
    expect(r.carried).toEqual(before.map((s) => s.id));
    expect(r.how).toEqual(["place", "place", "heading"]);
    expect(r.orphans).toEqual([]);
  });

  it("doesn't carry an ID to a different section that took a full one's place", () => {
    const before = old(
      "# Plan\n\n## Rewards\n\nBoth sides get one share after the deposit clears.\n\n## Goal\n\nGrow.\n",
    );
    const after = next(
      "# Plan\n\n## Support\n\nBrief the team on the common questions before launch day.\n\n## Goal\n\nGrow.\n",
    );
    const r = matchSections(before, after);
    expect(r.carried[1]).toBeNull();
    expect(r.orphans.map((o) => o.id)).toEqual([before[1]?.id]);
  });
});
