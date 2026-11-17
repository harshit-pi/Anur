import { z } from "zod";
import { DeviceId, PreviewId, ThreadId } from "../ids.ts";
import { DocId, SectionId } from "../sections/section.ts";

/**
 * One preview file, `docs/<doc>/previews/<device>/<preview>.json` (task 1.8):
 * one thread's proposed changes to one doc. A thread's current previews,
 * across every doc, form its change set (Data Model, "Previews that change
 * more than one section").
 *
 * Each part stores the text it was made against, its base, so a preview can
 * always be rebased onto newer text with a three-way merge; this is one of
 * the four rules later phases depend on ("What v1 must not break").
 *
 * The file holds only what is still undecided: a rejected or applied part is
 * gone from the next file this device writes.
 */

/** One section the preview changes: its whole subtree before, and as proposed. */
export const PreviewPart = z.object({
  /** The section whose subtree this part replaces; null only in a new-doc preview. */
  section: SectionId.nullable(),
  /** Its heading path when the preview was made, for display and for orphan suggestions. */
  path: z.array(z.string()),
  /** The section's subtree text the preview was made against. */
  base: z.string(),
  /** The proposed subtree text; new subsections appear here as new headings. */
  proposed: z.string(),
});
export type PreviewPart = z.infer<typeof PreviewPart>;

export const PreviewFile = z
  .object({
    id: PreviewId,
    thread: ThreadId,
    /** The change set this preview belongs to: one thread's previews across docs. */
    changeSet: z.string().min(1).max(64),
    /** When and where this file was written; across devices, the newest file wins. */
    at: z.iso.datetime({ precision: 3 }),
    dev: DeviceId,
    /** The line above the preview; null means it is described from its diff. */
    summary: z.string().nullable(),
    kind: z.enum(["edit", "new-doc"]),
    /** The doc it changes; null for a new doc, which has no ID until it is created. */
    doc: DocId.nullable(),
    /** For a new doc: where Apply creates it, relative to the opened folder. */
    newDocPath: z.string().min(1).nullable(),
    parts: z.array(PreviewPart),
  })
  .superRefine((p, ctx) => {
    const fail = (message: string) => {
      ctx.addIssue({ code: "custom", message });
    };
    if (p.kind === "edit") {
      if (!p.doc) fail("an edit preview names its doc");
      if (p.newDocPath !== null) fail("an edit preview has no new-doc path");
      const sections = p.parts.map((part) => part.section);
      if (sections.some((s) => s === null)) fail("every part of an edit names its section");
      if (new Set(sections).size !== sections.length) fail("a section appears in one part only");
    } else {
      if (p.doc !== null) fail("a new doc has no doc ID yet");
      if (!p.newDocPath?.toLowerCase().endsWith(".md")) fail("a new doc is a Markdown file");
      if (p.newDocPath?.split(/[/\\]/).some((seg) => seg === ".." || seg.startsWith(".")))
        fail("a new doc stays inside the folder and outside dot-folders");
      const [only] = p.parts;
      if (p.parts.length !== 1 || only?.section !== null || only.base !== "")
        fail("a new doc is one part with no section and an empty base");
    }
  });
export type PreviewFile = z.infer<typeof PreviewFile>;

/** The file that stands for a thread's preview of a doc: the newest, by time then device. */
export function currentPreview<P extends { at: string; dev: string }>(
  files: readonly P[],
): P | null {
  let best: P | null = null;
  for (const f of files) {
    if (!best || f.at > best.at || (f.at === best.at && f.dev > best.dev)) best = f;
  }
  return best;
}

export function encodePreviewFile(p: PreviewFile): string {
  return `${JSON.stringify(p, null, 2)}\n`;
}
