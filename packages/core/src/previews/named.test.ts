import { describe, expect, it } from "vitest";
import type { SectionId } from "../sections/section.ts";
import { buildSectionTree } from "../sections/tree.ts";
import { applyPart, partHunks, previewParts, rejectHunks, withPreview } from "./compute.ts";

/**
 * Group 3's named test rows (Repo and Tooling, "Tests"), for one section:
 * "Apply changes only approved sections" and "Previews survive newer typing".
 */

const DOC = `# Notifications

Tell the client within an hour.

## Retry timing

Retry after 1, 3 and 7 days.

Stop after three tries.

Log every retry.

## Channel

Email.
`;

const spans = (text: string) =>
  buildSectionTree(text, { fileName: "n.md" }).sections.map((s) => ({
    id: s.path.join("/") as SectionId,
    path: s.path,
    subtreeRange: s.subtreeRange,
  }));
const range = (text: string, heading: string) => {
  const s = spans(text).find((x) => x.path.at(-1) === heading);
  if (!s) throw new Error(heading);
  return s.subtreeRange;
};
/** The doc with one part made on its section, as Apply does. */
function apply(doc: string, part: Parameters<typeof applyPart>[1], heading: string) {
  const r = range(doc, heading);
  const made = applyPart(doc.slice(r.from, r.to), part);
  if (made.kind !== "ok") throw new Error("conflict");
  return doc.slice(0, r.from) + made.text + doc.slice(r.to);
}

const THREE = DOC.replace("Retry after 1, 3 and 7 days.", "Retry on pay day + 1.")
  .replace("Stop after three tries.", "Stop after four tries.")
  .replace("Log every retry.", "Log every retry, with its reason.");

describe("Apply changes only approved sections", () => {
  it("changes only the approved section's bytes", () => {
    const [part] = previewParts(DOC, THREE, spans(DOC));
    if (!part) throw new Error("no part");
    const after = apply(DOC, part, "Retry timing");
    const r = range(DOC, "Retry timing");
    expect(after.slice(0, r.from)).toBe(DOC.slice(0, r.from));
    expect(after.slice(after.length - (DOC.length - r.to))).toBe(DOC.slice(r.to));
  });

  it("with 2 of 3 edits kept, changes only those bytes", () => {
    const [part] = previewParts(DOC, THREE, spans(DOC));
    if (!part) throw new Error("no part");
    expect(partHunks(part)).toHaveLength(3);
    const kept = rejectHunks(part, [1]);
    if (!kept) throw new Error("nothing kept");
    expect(apply(DOC, kept, "Retry timing")).toBe(
      DOC.replace("Retry after 1, 3 and 7 days.", "Retry on pay day + 1.").replace(
        "Log every retry.",
        "Log every retry, with its reason.",
      ),
    );
  });

  it("adds new subsections inside the section only", () => {
    const proposed = DOC.replace(
      "Log every retry.\n",
      "Log every retry.\n\n### Pay day\n\nUse the pay day.\n",
    );
    const parts = previewParts(DOC, proposed, spans(DOC));
    expect(parts.map((p) => p.path.at(-1))).toEqual(["Retry timing"]);
    const part = parts[0];
    if (!part) throw new Error("no part");
    expect(apply(DOC, part, "Retry timing")).toBe(proposed);
  });

  it("applying one section's part leaves another section's part waiting, and both still apply", () => {
    const proposed = THREE.replace("Email.", "Email, then SMS.");
    const parts = previewParts(DOC, proposed, spans(DOC));
    expect(parts.map((p) => p.path.at(-1))).toEqual(["Retry timing", "Channel"]);
    const [retry, channel] = parts;
    if (!retry || !channel) throw new Error("parts");
    const once = apply(DOC, channel, "Channel");
    expect(once).toBe(DOC.replace("Email.", "Email, then SMS."));
    expect(apply(once, retry, "Retry timing")).toBe(proposed);
  });
});

describe("Previews survive newer typing", () => {
  const [part] = previewParts(DOC, THREE, spans(DOC));
  if (!part) throw new Error("no part");

  it("applies onto typing on other lines of the section, keeping both", () => {
    const typed = DOC.replace("Log every retry.", "Log every retry.\n\nAlert on the third.");
    const after = apply(typed, part, "Retry timing");
    expect(after).toContain("Retry on pay day + 1.");
    expect(after).toContain("Alert on the third.");
  });

  it("is untouched by typing in another section", () => {
    const typed = DOC.replace("Email.", "Email and in-app.");
    expect(apply(typed, part, "Retry timing")).toBe(THREE.replace("Email.", "Email and in-app."));
  });

  it("asks the person when they retyped a line the preview changes", () => {
    const typed = DOC.replace("1, 3 and 7", "2, 4 and 8");
    const r = range(typed, "Retry timing");
    expect(applyPart(typed.slice(r.from, r.to), part)).toEqual({ kind: "conflict" });
  });

  it("starts the next turn's copy from the doc with the preview made, onto a pull's changes", () => {
    const pulled = DOC.replace(
      "Tell the client within an hour.",
      "Tell the client within 30 minutes.",
    );
    const ids = new Map(spans(pulled).map((s) => [s.id, s.subtreeRange]));
    expect(
      withPreview(pulled, [part], (p) => (p.section ? (ids.get(p.section) ?? null) : null)),
    ).toBe(THREE.replace("Tell the client within an hour.", "Tell the client within 30 minutes."));
  });
});
