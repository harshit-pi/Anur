export {
  DocIdLine,
  DocMintLine,
  DocMoveLine,
  DocOrphanedLine,
  buildDocRegistry,
  docIdFor,
  normalizeDocPath,
  type DocRegistry,
} from "./doc-ids.ts";
export { hashId, mintId } from "./mint.ts";
export {
  SectionAliasLine,
  SectionIdLine,
  SectionMintLine,
  SectionOrphanedLine,
  SectionReattachLine,
  SectionRenameLine,
  assignSectionIds,
  buildSectionIdState,
  canonicalId,
  orphanedIds,
  type IdRecord,
  type SectionIdEvent,
  type SectionIdState,
  type SectionToSave,
} from "./section-ids.ts";
export {
  MATCH_BAR,
  SUGGEST_BAR,
  hasConflictMarkers,
  matchSections,
  sectionBodies,
  similarity,
  type MatchResult,
  type NewSection,
  type OldSection,
} from "./matcher.ts";
