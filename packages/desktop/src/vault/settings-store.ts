import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { SettingsFile, anurPaths, mergeSettings, withSetting, type SettingEntry } from "@anur/core";
import { writeFileAtomic } from "./anur-folder.ts";
import { readFile } from "./anur-copy.ts";

/**
 * Settings in `.anur/settings/`: this device writes only its own file, and
 * reading combines every device's, the latest change winning per key.
 */
export class SettingsStore {
  constructor(
    private readonly anurDir: string,
    private readonly device: string,
    private readonly now: () => number = Date.now,
  ) {}

  private get dir() {
    return path.join(this.anurDir, path.dirname(anurPaths.settings(this.device)));
  }

  private async readOne(file: string): Promise<SettingsFile> {
    try {
      const parsed = SettingsFile.safeParse(JSON.parse(await readFile(file, "utf8")));
      return parsed.success ? parsed.data : {};
    } catch {
      return {};
    }
  }

  async set(key: string, value: SettingEntry["value"]): Promise<void> {
    const file = path.join(this.anurDir, anurPaths.settings(this.device));
    const next = withSetting(
      await this.readOne(file),
      key,
      value,
      new Date(this.now()).toISOString(),
    );
    await mkdir(this.dir, { recursive: true });
    await writeFileAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
  }

  async all(): Promise<Record<string, SettingEntry["value"]>> {
    let names: string[];
    try {
      names = (await readdir(this.dir)).filter((n) => n.endsWith(".json"));
    } catch {
      return {};
    }
    const files = await Promise.all(
      names.map(async (n) => ({
        dev: n.replace(/\.json$/, ""),
        settings: await this.readOne(path.join(this.dir, n)),
      })),
    );
    return mergeSettings(files);
  }
}
