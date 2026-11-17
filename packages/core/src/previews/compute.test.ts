import { describe, expect, it } from "vitest";
import type { SectionId } from "../sections/section.ts";
import { buildSectionTree } from "../sections/tree.ts";
import { applyPart, partHunks, previewParts, rejectHunks, withPreview } from "./compute.ts";

const DOC = `# Notifications

Tell the client within an hour.

## Retry timing

Retry after 1, 3 and 7 days.

Stop after three tries.

### Pay day

Use the pay day.

## Channel

Email.
`;

const spans = (text: string) =>
  buildSectionTree(text, { fileName: "n.md" }).sections.map((s) => ({
    id: s.path.join("/") as SectionId,
    path: s.path,
    subtreeRange: s.subtreeRange,
  }));

describe("previewParts", () => {
  it("gives each change to the smallest section holding it", () => {
    const proposed = DOC.replace(
      "Retry after 1, 3 and 7 days.",
      "Retry on the pay day + 1.",
    ).replace("Email.", "Email, then SMS.");
    const parts = previewParts(DOC, proposed, spans(DOC));
    expect(parts.map((p) => p.path.at(-1))).toEqual(["Retry timing", "Channel"]);
    expect(parts[0]?.base.startsWith("## Retry timing")).toBe(true);
    expect(parts[0]?.proposed).toContain("Retry on the pay day + 1.");
    // A part holds only its own section's changes.
    expect(parts[0]?.proposed).not.toContain("SMS");
    expect(parts[0]?.proposed).toContain("### Pay day");
  });

  it("gives a line added at a section's end, and a new subsection, to that section", () => {
    const proposed = DOC.replace("Email.\n", "Email.\n\n### SMS\n\nOnly for amounts over $500.\n");
    const parts = previewParts(DOC, proposed, spans(DOC));
    expect(parts.map((p) => p.path.at(-1))).toEqual(["Channel"]);
    expect(parts[0]?.proposed).toBe(
      "## Channel\n\nEmail.\n\n### SMS\n\nOnly for amounts over $500.\n",
    );
  });

  it("is empty when nothing changed", () => {
    expect(previewParts(DOC, DOC, spans(DOC))).toEqual([]);
  });
});

describe("applying a part", () => {
  const proposed = DOC.replace("Retry after 1, 3 and 7 days.", "Retry on the pay day + 1.");
  const [part] = previewParts(DOC, proposed, spans(DOC));
  if (!part) throw new Error("no part");

  it("lands on newer typing elsewhere in the section", () => {
    const current = part.base.replace("Use the pay day.", "Use the client's pay day.");
    const made = applyPart(current, part);
    expect(made).toEqual({
      kind: "ok",
      text: current.replace("Retry after 1, 3 and 7 days.", "Retry on the pay day + 1."),
    });
  });

  it("asks for a refresh when the same line was retyped", () => {
    expect(applyPart(part.base.replace("1, 3 and 7", "2, 4 and 8"), part)).toEqual({
      kind: "conflict",
    });
  });
});

describe("per-edit choice", () => {
  const proposed = DOC.replace("Retry after 1, 3 and 7 days.", "Retry on the pay day + 1.").replace(
    "Stop after three tries.",
    "Stop after four tries.",
  );
  const [part] = previewParts(DOC, proposed, spans(DOC));
  if (!part) throw new Error("no part");

  it("lists each edit, and drops the rejected ones", () => {
    const hunks = partHunks(part);
    expect(hunks.map((h) => h.added.trim())).toEqual([
      "Retry on the pay day + 1.",
      "Stop after four tries.",
    ]);
    const kept = rejectHunks(part, [0]);
    expect(kept?.proposed).toContain("Retry after 1, 3 and 7 days.");
    expect(kept?.proposed).toContain("Stop after four tries.");
    expect(rejectHunks(part, [0, 1])).toBeNull();
  });
});

describe("withPreview", () => {
  it("makes every part onto the decided text, for the working copy", () => {
    const proposed = DOC.replace(
      "Retry after 1, 3 and 7 days.",
      "Retry on the pay day + 1.",
    ).replace("Email.", "Email, then SMS.");
    const parts = previewParts(DOC, proposed, spans(DOC));
    const ranges = new Map(spans(DOC).map((s) => [s.id, s.subtreeRange]));
    expect(
      withPreview(DOC, parts, (p) => (p.section ? (ranges.get(p.section) ?? null) : null)),
    ).toBe(proposed);
  });
});
