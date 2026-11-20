import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "../../vault/anur-folder.ts";

/**
 * The spaces open in windows when Anur last quit, the front one first, each
 * with where its window sat, so a restart opens each again in its own window,
 * in the same place. In app support, never the vault.
 */
const Bounds = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });
export type WindowBounds = z.infer<typeof Bounds>;
export type OpenWindow = { folder: string; bounds: WindowBounds | null };

const OpenWindows = z.object({
  windows: z.array(z.object({ folder: z.string(), bounds: Bounds.nullable() })).max(20),
});
const FILE = "open-windows.json";

export async function readOpenWindows(appSupportDir: string): Promise<OpenWindow[]> {
  try {
    const parsed = OpenWindows.safeParse(
      JSON.parse(await readFile(path.join(appSupportDir, FILE), "utf8")),
    );
    return parsed.success ? parsed.data.windows : [];
  } catch {
    return [];
  }
}

export async function saveOpenWindows(appSupportDir: string, open: OpenWindow[]): Promise<void> {
  const seen = new Set<string>();
  const windows = open.filter((w) => !seen.has(w.folder) && seen.add(w.folder)).slice(0, 20);
  await mkdir(appSupportDir, { recursive: true, mode: 0o700 });
  await writeFileAtomic(
    path.join(appSupportDir, FILE),
    `${JSON.stringify({ windows }, null, 2)}\n`,
  );
}
