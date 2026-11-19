import { randomBytes } from "node:crypto";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ANUR_DIR,
  GENERATED_ATTRIBUTES,
  IGNORE_ALL,
  accessFor,
  anurPaths,
  formatFileText,
  gitignoreWithDeviceOnly,
  type FolderAccess,
} from "@anur/core";
import { readFile } from "./anur-copy.ts";

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
 * - A new `.anur/` gets `format.json` and the files in `keepAnurFiles`. It is
 *   committed with git by default (2026-11-18), so threads and history travel
 *   with the folder; a "*" line in its `.gitignore`, set from Settings, is how
 *   a folder chooses not to, and Anur never adds or removes it on its own.
 * - A `format.json` that is newer, unreadable or has no number makes the
 *   folder read-only, and Anur never overwrites it.
 */
export async function openAnurFolder(root: string): Promise<OpenedAnurFolder> {
  const dir = path.join(root, ANUR_DIR);
  const formatFile = path.join(dir, anurPaths.format());
  const created = !(await exists(dir));

  if (created) await mkdir(dir, { recursive: true });

  if (!(await exists(formatFile))) {
    await writeFileAtomic(formatFile, formatFileText());
  }
  const access = accessFor(await readFile(formatFile, "utf8"));

  if (access.mode === "writable") await keepAnurFiles(dir);

  return { ...access, dir, created };
}

/**
 * The files that say how `.anur/` is treated, put back when missing: its
 * `.ignore` keeps searches out; its `.gitignore` lists what stays on each
 * Mac (18.10); its `.gitattributes` has GitHub collapse it in diffs (18.12).
 * The person's own lines in each are kept.
 */
export async function keepAnurFiles(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const at = (name: string) => path.join(dir, name);
  if (!(await exists(at(anurPaths.ignore()))))
    await writeFileAtomic(at(anurPaths.ignore()), IGNORE_ALL);
  const ignore = await readFile(at(anurPaths.gitignore()), "utf8").catch(() => null);
  const next = gitignoreWithDeviceOnly(ignore);
  if (next !== null) await writeFileAtomic(at(anurPaths.gitignore()), next);
  if (!(await exists(at(anurPaths.attributes()))))
    await writeFileAtomic(at(anurPaths.attributes()), GENERATED_ATTRIBUTES);
}
