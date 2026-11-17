import { z } from "zod";

/**
 * The section record (Data Model, "A section"). One schema is the source of
 * both the TypeScript type and the check every IPC message gets.
 *
 * Field names are camelCase here; the design writes `own_range` for
 * `ownRange`, and so on. Text is never stored in the record: it is read from
 * the file through the ranges. Positions are offsets into the file's text as
 * read, in UTF-16 code units, the same positions CodeMirror uses.
 */

/** Made once for a section, then kept across renames (task 1.12 mints it). */
export const SectionId = z.string().min(1).brand<"SectionId">();
export type SectionId = z.infer<typeof SectionId>;

/** Made once for a doc from its path when first seen (task 1.11). */
export const DocId = z.string().min(1).brand<"DocId">();
export type DocId = z.infer<typeof DocId>;

export const Range = z
  .object({ from: z.int().nonnegative(), to: z.int().nonnegative() })
  .refine((r) => r.from <= r.to, { message: "a range must not end before it starts" });
export type Range = z.infer<typeof Range>;

/**
 * Where a section comes from: `markdown` for headings in Core; a plugin adds
 * its own, such as `repo` or `pr`, without changing the record.
 */
export const SectionSource = z.string().regex(/^[a-z][a-z0-9-]*$/);
export type SectionSource = z.infer<typeof SectionSource>;

/** A wiki link written in a section's own text. */
export const SectionLink = z.object({
  /** Where the link is written in the file. */
  range: Range,
  /** The file as written, or "" for a link within the same file. */
  target: z.string(),
  heading: z.string().nullable(),
  alias: z.string().nullable(),
  embed: z.boolean(),
  /** The section it points to once links are resolved; null when broken or not yet resolved. */
  resolved: SectionId.nullable(),
});
export type SectionLink = z.infer<typeof SectionLink>;

export const Section = z
  .object({
    id: SectionId,
    doc: DocId,
    source: SectionSource,
    /** Heading texts from the title down to this section, title first. */
    path: z.array(z.string()).min(1),
    /** Heading level, 1 to 6; the title section is 1. */
    level: z.int().min(1).max(6),
    /** Position among siblings with the same heading text, from 0; used only when minting IDs. */
    ordinal: z.int().nonnegative(),
    /** Position among all siblings, from 0. */
    order: z.int().nonnegative(),
    /** The heading line itself; null for a title section with no H1, which starts at the top of the text. */
    headingRange: Range.nullable(),
    /** From the heading to the first subheading. */
    ownRange: Range,
    /** From the heading to the next heading of the same or a higher level. */
    subtreeRange: Range,
    /** Wiki links in this section's own text. */
    linksOut: z.array(SectionLink),
    /** Sections, in any doc, with a link to this one. */
    linksIn: z.array(SectionId),
  })
  .superRefine((s, ctx) => {
    const fail = (message: string) => {
      ctx.addIssue({ code: "custom", message });
    };
    if (s.ownRange.from !== s.subtreeRange.from)
      fail("ownRange and subtreeRange must start together");
    if (s.ownRange.to > s.subtreeRange.to) fail("ownRange must sit inside subtreeRange");
    if (s.headingRange) {
      if (s.headingRange.from !== s.ownRange.from) fail("the heading must start the section");
      if (s.headingRange.to > s.ownRange.to) fail("the heading must sit inside ownRange");
    }
    for (const link of s.linksOut) {
      if (link.range.from < s.ownRange.from || link.range.to > s.ownRange.to) {
        fail("linksOut must be written in the section's own text");
      }
    }
  });
export type Section = z.infer<typeof Section>;

/** The path as people read it: `Failed-payment notifications > Retry timing`. */
export function formatPath(path: readonly string[]): string {
  return path.join(" > ");
}

/** The section's own text, from its heading to its first subheading. */
export function ownText(file: string, section: Pick<Section, "ownRange">): string {
  return file.slice(section.ownRange.from, section.ownRange.to);
}

/** The section's whole subtree, its subsections included. */
export function subtreeText(file: string, section: Pick<Section, "subtreeRange">): string {
  return file.slice(section.subtreeRange.from, section.subtreeRange.to);
}
