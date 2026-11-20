import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ANUR_DIR,
  anurPaths,
  gitignoreCommitting,
  gitignoreKeepingDecisions,
  keepsAnurOut,
} from "@anur/core";
import { writeFileAtomic } from "../vault/anur-folder.ts";
import { AGENTS, DEFAULT_AGENT, isAgentId, type AgentId } from "../shared/agents.ts";
import { DEFAULT_FLAGS, flagsFrom, type FeatureFlags } from "../shared/features.ts";

/**
 * Settings main needs to act on (2.25). App-wide ones live in app support;
 * whether a folder commits `.anur/` is the folder's own: its `.anur/.gitignore`
 * holds "*" unless the folder commits it, as the design says.
 */

export type AppSettings = {
  /** Which switchable Core features are on (group 12). */
  features: FeatureFlags;
  /** The agent new threads run on. */
  defaultAgent: AgentId;
  /** The agents switched on in Settings → Agents; none leaves Think asking for one. */
  agents: AgentId[];
  /** Use agents' edits as they land, instead of proposing them; off by default. */
  autoApply: boolean;
  /** Download updates and install them on quit by themselves; on by default. */
  autoUpdate: boolean;
  /** Live agent sessions before idle ones close (13.3); eight by default. */
  sessionLimit: number;
  /** The name others see on this person's threads; null takes git's, else the Mac's. */
  name: string | null;
  /** Plugins switched on, by folder path (group 19). */
  plugins: Record<string, string[]>;
  /** Downloaded plugins update themselves; on by default, unlike Obsidian. */
  autoUpdatePlugins: boolean;
};

const DEFAULTS: AppSettings = {
  features: { ...DEFAULT_FLAGS },
  defaultAgent: DEFAULT_AGENT,
  agents: [DEFAULT_AGENT],
  autoApply: false,
  autoUpdate: true,
  sessionLimit: 8,
  name: null,
  plugins: {},
  autoUpdatePlugins: true,
};

/** The limits Settings offers; anything else saved reads as the default. */
export const SESSION_LIMITS = [2, 4, 6, 8, 12, 16, 20];
const sessionLimitOf = (v: unknown) =>
  typeof v === "number" && SESSION_LIMITS.includes(v) ? v : DEFAULTS.sessionLimit;

export class AppSettingsStore {
  private current: AppSettings = { ...DEFAULTS };

  constructor(private readonly appSupport: string) {}

  private get file() {
    return path.join(this.appSupport, "app-settings.json");
  }

  async load(): Promise<AppSettings> {
    try {
      const raw = JSON.parse(await readFile(this.file, "utf8")) as Partial<AppSettings> & {
        sectionHistory?: unknown;
      };
      this.current = {
        features: flagsFrom(raw.features, { sectionHistory: raw.sectionHistory }),
        defaultAgent: isAgentId(raw.defaultAgent) ? raw.defaultAgent : DEFAULT_AGENT,
        agents: agentsFrom(raw.agents),
        autoApply: raw.autoApply === true,
        autoUpdate: raw.autoUpdate !== false,
        sessionLimit: sessionLimitOf(raw.sessionLimit),
        name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 80) : null,
        plugins: pluginsFrom(raw.plugins),
        autoUpdatePlugins: raw.autoUpdatePlugins !== false,
      };
    } catch {
      this.current = { ...DEFAULTS };
    }
    return this.current;
  }

  get(): AppSettings {
    return this.current;
  }

  async set(change: Partial<AppSettings>): Promise<AppSettings> {
    this.current = { ...this.current, ...change };
    await writeFileAtomic(this.file, JSON.stringify(this.current, null, 1));
    return this.current;
  }
}

/** Saved plugin switches: folder paths to plugin IDs; anything malformed is dropped. */
function pluginsFrom(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string[]> = {};
  for (const [folder, ids] of Object.entries(raw as Record<string, unknown>))
    if (Array.isArray(ids)) out[folder] = ids.filter((x): x is string => typeof x === "string");
  return out;
}

/** True when the folder commits `.anur/` with git: no "*" line in its ignore file. */
export async function commitsAnur(folder: string): Promise<boolean> {
  const text = await readFile(path.join(folder, ANUR_DIR, anurPaths.gitignore()), "utf8").catch(
    () => null,
  );
  return !keepsAnurOut(text);
}

export async function setCommitsAnur(folder: string, commit: boolean): Promise<void> {
  const file = path.join(folder, ANUR_DIR, anurPaths.gitignore());
  const now = await readFile(file, "utf8").catch(() => null);
  const next = gitignoreCommitting(now, commit);
  // Keeping `.anur/` out of git still commits its decisions (18.9).
  await writeFile(file, commit ? next : (gitignoreKeepingDecisions(next) ?? next));
}

/** Saved agent switches: known agents that can run threads; none saved is Claude Code alone. */
function agentsFrom(raw: unknown): AgentId[] {
  if (!Array.isArray(raw)) return [DEFAULT_AGENT];
  return [...new Set(raw.filter((x): x is AgentId => isAgentId(x) && AGENTS[x].runsThreads))];
}
