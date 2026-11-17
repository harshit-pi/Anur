import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ANUR_DIR,
  IGNORE_ALL,
  accessFor,
  anurPaths,
  formatFileText,
  type FolderAccess,
} from "@anur/core";

export type OpenedAnurFolder = FolderAccess & {
  /** The absolute path of `.anur/`. */
  dir: string;
  /** True when this open created `.anur/`. */
  created: boolean;
};

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Write a whole file so a reader never sees half of it: a temporary file, then a rename. */
export async function writeFileAtomic(file: string, text: string | Uint8Array): Promise<void> {
  const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmp, text, { flag: "wx" });
  await rename(tmp, file);
}

/**
 * Open, or create, the `.anur/` folder at the root of an opened folder.
 *
 * - A new `.anur/` gets `format.json` and its own `.gitignore` and `.ignore`,
 *   so git and searches skip it without any change at the folder root.
 * - On later opens a missing `.ignore` is put back, since it keeps agents'
 *   searches out of other threads. A missing `.gitignore` is left missing:
 *   removing it is how a folder chooses to commit `.anur/`.
 * - A `format.json` that is newer, unreadable or has no number makes the
 *   folder read-only, and Anur never overwrites it.
 */
export async function openAnurFolder(root: string): Promise<OpenedAnurFolder> {
  const dir = path.join(root, ANUR_DIR);
  const formatFile = path.join(dir, anurPaths.format());
  const created = !(await exists(dir));

  if (created) {
    await mkdir(dir, { recursive: true });
    await writeFileAtomic(path.join(dir, anurPaths.gitignore()), IGNORE_ALL);
  }

  if (!(await exists(formatFile))) {
    await writeFileAtomic(formatFile, formatFileText());
  }
  const access = accessFor(await readFile(formatFile, "utf8"));

  if (access.mode === "writable" && !(await exists(path.join(dir, anurPaths.ignore())))) {
    await writeFileAtomic(path.join(dir, anurPaths.ignore()), IGNORE_ALL);
  }

  return { ...access, dir, created };
}
