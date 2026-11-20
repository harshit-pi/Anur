import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "../../vault/anur-folder.ts";

/**
 * The spaces open in windows when Anur last quit, the front one first, so
 * a restart opens each again in its own window. In app support, never the vault.
 */
const OpenWindows = z.object({ folders: z.array(z.string()).max(20) });
const FILE = "open-windows.json";

export async function readOpenWindows(appSupportDir: string): Promise<string[]> {
  try {
    const parsed = OpenWindows.safeParse(
      JSON.parse(await readFile(path.join(appSupportDir, FILE), "utf8")),
    );
    return parsed.success ? parsed.data.folders : [];
  } catch {
    return [];
  }
}

export async function saveOpenWindows(appSupportDir: string, folders: string[]): Promise<void> {
  await mkdir(appSupportDir, { recursive: true, mode: 0o700 });
  await writeFileAtomic(
    path.join(appSupportDir, FILE),
    `${JSON.stringify({ folders: [...new Set(folders)].slice(0, 20) }, null, 2)}\n`,
  );
}
