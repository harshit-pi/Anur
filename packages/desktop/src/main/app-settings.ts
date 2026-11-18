import { readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { ANUR_DIR, IGNORE_ALL, anurPaths } from "@anur/core";
import { writeFileAtomic } from "../vault/anur-folder.ts";
import { DEFAULT_AGENT, isAgentId, type AgentId } from "../shared/agents.ts";
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
  /** Use agents' edits as they land, instead of proposing them; off by default. */
  autoApply: boolean;
  /** Download updates and install them on quit by themselves; on by default. */
  autoUpdate: boolean;
};

const DEFAULTS: AppSettings = {
  features: { ...DEFAULT_FLAGS },
  defaultAgent: DEFAULT_AGENT,
  autoApply: false,
  autoUpdate: true,
};

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
        autoApply: raw.autoApply === true,
        autoUpdate: raw.autoUpdate !== false,
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

/** True when the folder commits `.anur/` with git: its ignore file is gone. */
export async function commitsAnur(folder: string): Promise<boolean> {
  return stat(path.join(folder, ANUR_DIR, anurPaths.gitignore())).then(
    () => false,
    () => true,
  );
}

export async function setCommitsAnur(folder: string, commit: boolean): Promise<void> {
  const file = path.join(folder, ANUR_DIR, anurPaths.gitignore());
  if (commit) await rm(file, { force: true });
  else await writeFile(file, IGNORE_ALL);
}
