import type { ViewUpdate } from "@codemirror/view";

/**
 * Every update to the open page, for views that show part of it, such as
 * Think's section editor. The page calls each listener on every update.
 */
export const pageUpdates = new Set<(u: ViewUpdate) => void>();
