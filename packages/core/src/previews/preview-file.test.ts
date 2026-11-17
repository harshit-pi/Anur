import { describe, expect, it } from "vitest";
import { PreviewFile, currentPreview, encodePreviewFile } from "./preview-file.ts";

const BASE = "## Retry timing\n\nRetry after 1 hour, then 24 hours.\n\n";
const PROPOSED =
  "## Retry timing\n\nRetry after 30 minutes, then 6 hours.\n\n### Weekends\n\nSame times.\n\n";

export const SAMPLE_PREVIEW = {
  id: "p1",
  thread: "t1",
  changeSet: "cs1",
  at: "2026-11-17T01:00:00.000Z",
  dev: "dev1",
  summary: null,
  kind: "edit",
  doc: "d1",
  newDocPath: null,
  parts: [
    {
      section: "s-retry",
      path: ["Failed-payment notifications", "Retry timing"],
      base: BASE,
      proposed: PROPOSED,
    },
    {
      section: "s-channel",
      path: ["Failed-payment notifications", "Notification channel"],
      base: "## Notification channel\n\nEmail first.\n",
      proposed: "## Notification channel\n\nEmail, then SMS.\n",
    },
  ],
};

const NEW_DOC = {
  ...SAMPLE_PREVIEW,
  id: "p2",
  kind: "new-doc",
  doc: null,
  newDocPath: "plans/Launch plan.md",
  parts: [
    { section: null, path: ["Launch plan"], base: "", proposed: "# Launch plan\n\n## Rollout\n" },
  ],
};

describe("preview files", () => {
  it("round-trip with every part's base and proposed text", () => {
    const parsed = PreviewFile.parse(
      JSON.parse(encodePreviewFile(PreviewFile.parse(SAMPLE_PREVIEW))),
    );
    expect(parsed).toEqual(SAMPLE_PREVIEW);
    expect(parsed.parts[0]?.base).toBe(BASE);
  });

  it("describe a new doc as one part with an empty base", () => {
    expect(PreviewFile.safeParse(NEW_DOC).success).toBe(true);
  });

  it.each([
    ["an edit with no doc", { ...SAMPLE_PREVIEW, doc: null }],
    ["an edit with a new-doc path", { ...SAMPLE_PREVIEW, newDocPath: "x.md" }],
    [
      "an edit part with no section",
      { ...SAMPLE_PREVIEW, parts: [{ ...SAMPLE_PREVIEW.parts[0], section: null }] },
    ],
    [
      "one section in two parts",
      { ...SAMPLE_PREVIEW, parts: [SAMPLE_PREVIEW.parts[0], SAMPLE_PREVIEW.parts[0]] },
    ],
    ["a new doc with a doc ID", { ...NEW_DOC, doc: "d9" }],
    ["a new doc that isn't Markdown", { ...NEW_DOC, newDocPath: "notes.txt" }],
    ["a new doc outside the folder", { ...NEW_DOC, newDocPath: "../escape.md" }],
    ["a new doc in a dot-folder", { ...NEW_DOC, newDocPath: ".anur/x.md" }],
    ["a new doc with a base", { ...NEW_DOC, parts: [{ ...NEW_DOC.parts[0], base: "old" }] }],
    ["a preview ID that could leave its folder", { ...SAMPLE_PREVIEW, id: "../p" }],
  ])("refuse %s", (_, bad) => {
    expect(PreviewFile.safeParse(bad).success).toBe(false);
  });

  it("let the newest file across devices stand for the preview", () => {
    const a = { at: "2026-11-17T01:00:00.000Z", dev: "dev1" };
    const b = { at: "2026-11-17T01:00:05.000Z", dev: "dev2" };
    const c = { at: "2026-11-17T01:00:05.000Z", dev: "dev3" };
    expect(currentPreview([a, b])).toBe(b);
    expect(currentPreview([c, b, a])).toBe(c);
    expect(currentPreview([])).toBeNull();
  });
});
