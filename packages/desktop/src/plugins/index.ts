import type { Plugin } from "@anur/core";
import { engineering } from "./engineering.ts";

/**
 * Plugins that ship with Anur (group 19). Each process loads the ones a
 * folder has switched on, and keeps only its own points. Community plugins
 * come with a sandbox (Design - Extensions).
 */
export const FIRST_PARTY: readonly Plugin[] = [engineering];

export const pluginById = (id: string): Plugin | undefined =>
  FIRST_PARTY.find((p) => p.manifest.id === id);
