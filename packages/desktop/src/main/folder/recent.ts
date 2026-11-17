import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "../../vault/anur-folder.ts";

/**
 * Folders opened recently on this device, in app support, so the last one
 * reopens at launch. Never in the vault.
 */
const Recent = z.object({ folders: z.array(z.string()).max(20) });
const FILE = "recent-folders.json";

export async function readRecent(appSupportDir: string): Promise<string[]> {
  try {
    const parsed = Recent.safeParse(
      JSON.parse(await readFile(path.join(appSupportDir, FILE), "utf8")),
    );
    return parsed.success ? parsed.data.folders : [];
  } catch {
    return [];
  }
}

export async function rememberFolder(appSupportDir: string, folder: string): Promise<void> {
  const folders = [folder, ...(await readRecent(appSupportDir)).filter((f) => f !== folder)].slice(
    0,
    20,
  );
  await mkdir(appSupportDir, { recursive: true, mode: 0o700 });
  await writeFileAtomic(
    path.join(appSupportDir, FILE),
    `${JSON.stringify({ folders }, null, 2)}\n`,
  );
}
