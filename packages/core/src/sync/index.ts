export { PROVIDER_NAME, cloudProviderOf, type CloudProvider } from "./cloud.ts";
export { findConflictCopies, type ConflictCopy } from "./conflict-copies.ts";
export {
  applyMerge,
  planConflictMerge,
  type MergeChoices,
  type MergePart,
  type MergePlan,
} from "./conflict-merge.ts";
export { containsLines, decideConflict, type ConflictOutcome } from "./conflict-resolve.ts";
