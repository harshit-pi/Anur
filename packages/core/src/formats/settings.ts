import { z } from "zod";

/**
 * `settings/<device>.json` (task 1.9). Each device writes only its own file,
 * and for each setting the latest change wins, so two machines never write
 * one file and never lose each other's choices.
 */
export const SettingEntry = z.object({
  value: z.json(),
  /** When this device last changed it; ISO 8601 in UTC. */
  at: z.iso.datetime({ precision: 3 }),
});
export type SettingEntry = z.infer<typeof SettingEntry>;

/** Keys are dotted names such as `git.commitAnur`. */
const SettingKey = z.string().regex(/^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)*$/);

export const SettingsFile = z.record(SettingKey, SettingEntry);
export type SettingsFile = z.infer<typeof SettingsFile>;

/** Every device's settings combined: per key, the latest change wins, ties broken by device. */
export function mergeSettings(
  files: readonly { dev: string; settings: SettingsFile }[],
): Record<string, z.infer<typeof SettingEntry>["value"]> {
  const best = new Map<string, { at: string; dev: string; value: SettingEntry["value"] }>();
  for (const { dev, settings } of files) {
    for (const [key, entry] of Object.entries(settings)) {
      const prev = best.get(key);
      if (!prev || entry.at > prev.at || (entry.at === prev.at && dev > prev.dev)) {
        best.set(key, { at: entry.at, dev, value: entry.value });
      }
    }
  }
  return Object.fromEntries([...best].map(([k, v]) => [k, v.value]));
}

/** This device's file after one change. */
export function withSetting(
  file: SettingsFile,
  key: string,
  value: SettingEntry["value"],
  at: string,
): SettingsFile {
  return SettingsFile.parse({ ...file, [key]: { value, at } });
}
