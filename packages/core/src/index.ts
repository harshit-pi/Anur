/**
 * The `.anur/` format number, written to `.anur/format.json`.
 * Changes within one number only add fields; an app that finds a newer
 * number opens the folder read-only.
 */
export const FORMAT_VERSION = 1;

export {
  markdownExtensions,
  markdownParser,
  readWikiLink,
  type WikiLink,
} from "./markdown/index.ts";
export {
  DocId,
  Range,
  Section,
  SectionId,
  SectionLink,
  SectionSource,
  formatPath,
  ownText,
  subtreeText,
  buildSectionTree,
  resolveHeading,
  toSectionRecords,
  type SectionNode,
  type SectionTree,
  type TreeLink,
} from "./sections/index.ts";
