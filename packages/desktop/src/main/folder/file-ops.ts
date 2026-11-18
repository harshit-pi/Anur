import { constants } from "node:fs";
import { copyFile, cp, lstat, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { normalizeDocPath } from "@anur/core";
import type { FolderState } from "../../shared/ipc-contract.ts";

/**
 * What the files panel does to the folder: new folders, renames and moves,
 * copies and the Trash. Every path is relative to the open folder and stays
 * inside it, out of hidden folders such as `.anur`, and nothing is written
 * over a file that is already there.
 */

type Failed = { kind: "failed"; reason: string };
const failed = (reason: string): Failed => ({ kind: "failed", reason });

/** A relative path in the folder that isn't hidden, or why not. */
function checkPath(folder: FolderState, requested: string): string | Failed {
  let rel: string;
  try {
    rel = normalizeDocPath(requested);
  } catch {
    return failed("That's outside this folder.");
  }
  if (rel.split("/").some((part) => part.startsWith(".")))
    return failed("Names can't start with a dot; those files are hidden.");
  if (rel.split("/").some((part) => /[\\:]/.test(part))) return failed("Names can't hold \\ or :.");
  const full = path.resolve(folder.path, rel);
  if (!full.startsWith(path.resolve(folder.path) + path.sep))
    return failed("That's outside this folder.");
  return rel;
}

const exists = (full: string) =>
  lstat(full).then(
    () => true,
    () => false,
  );

const isFolderIn = (folder: FolderState, rel: string) => folder.folders.includes(rel);

/** Docs and files at or under `rel`, which is a doc, a file or a folder. */
export function docsUnder(folder: FolderState, rel: string): string[] {
  return [...folder.docs, ...folder.files].filter((d) => d === rel || d.startsWith(`${rel}/`));
}

const isFileIn = (folder: FolderState, rel: string) =>
  folder.docs.includes(rel) || folder.files.includes(rel);

export async function createFolder(
  folder: FolderState,
  requested: string,
): Promise<{ kind: "created"; path: string } | Failed> {
  if (folder.mode !== "writable") return failed("This folder is read-only.");
  const rel = checkPath(folder, requested);
  if (typeof rel !== "string") return rel;
  try {
    await mkdir(path.join(folder.path, rel));
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return failed(code === "EEXIST" ? `${rel} already exists.` : (e as Error).message);
  }
  return { kind: "created", path: rel };
}

/**
 * Rename or move a doc or a folder. A doc keeps its ".md"; a folder can't go
 * inside itself. Returns each doc that moved, so their IDs can follow.
 */
export async function moveEntry(
  folder: FolderState,
  from: string,
  to: string,
): Promise<{ kind: "moved"; to: string; docs: { from: string; to: string }[] } | Failed> {
  if (folder.mode !== "writable") return failed("This folder is read-only.");
  const src = checkPath(folder, from);
  if (typeof src !== "string") return src;
  const dest = checkPath(folder, to);
  if (typeof dest !== "string") return dest;
  const isDoc = isFileIn(folder, src);
  if (!isDoc && !isFolderIn(folder, src)) return failed(`There's no ${src} in this folder.`);
  if (src === dest) return { kind: "moved", to: dest, docs: [] };
  // A doc stays a doc and an image an image: the ending can't change.
  const ending = path.posix.extname(src).toLowerCase();
  if (isDoc && path.posix.extname(dest).toLowerCase() !== ending)
    return failed(`The name has to end in ${ending}.`);
  if (!isDoc && (dest === src || dest.startsWith(`${src}/`)))
    return failed("A folder can't go inside itself.");
  const destFull = path.join(folder.path, dest);
  // On a Mac, "plan.md" to "Plan.md" is the same file: only the case changes.
  const caseOnly = src.toLowerCase() === dest.toLowerCase();
  if (!caseOnly && (await exists(destFull)))
    return failed(`There's already a ${path.posix.basename(dest)} there.`);
  const parent = path.posix.dirname(dest);
  if (parent !== "." && !isFolderIn(folder, parent) && !(await exists(path.dirname(destFull))))
    return failed(`There's no folder ${parent}.`);
  try {
    await rename(path.join(folder.path, src), destFull);
  } catch (e) {
    return failed((e as Error).message);
  }
  const docs = docsUnder(folder, src).map((d) => ({ from: d, to: dest + d.slice(src.length) }));
  return { kind: "moved", to: dest, docs };
}

/** A copy beside the doc or file: "Plan copy.md", then "Plan copy 2.md". */
export async function duplicateDoc(
  folder: FolderState,
  requested: string,
): Promise<{ kind: "created"; path: string } | Failed> {
  if (folder.mode !== "writable") return failed("This folder is read-only.");
  const src = checkPath(folder, requested);
  if (typeof src !== "string") return src;
  if (!isFileIn(folder, src)) return failed(`There's no ${src} in this folder.`);
  const ending = path.posix.extname(src);
  const stem = src.slice(0, src.length - ending.length);
  for (let n = 1; n < 1000; n++) {
    const rel = `${stem} copy${n === 1 ? "" : ` ${String(n)}`}${ending}`;
    try {
      await copyFile(
        path.join(folder.path, src),
        path.join(folder.path, rel),
        constants.COPYFILE_EXCL,
      );
      return { kind: "created", path: rel };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") return failed((e as Error).message);
    }
  }
  return failed("Too many copies with that name.");
}

/**
 * Put a doc or a folder in the Trash; returns the docs that went with it and,
 * when known, where it landed, so Undo can bring it back.
 */
export async function trashEntry(
  folder: FolderState,
  requested: string,
  trash: (full: string) => Promise<string | null>,
): Promise<{ kind: "trashed"; docs: string[]; trashed: string | null } | Failed> {
  if (folder.mode !== "writable") return failed("This folder is read-only.");
  const rel = checkPath(folder, requested);
  if (typeof rel !== "string") return rel;
  if (!isFileIn(folder, rel) && !isFolderIn(folder, rel))
    return failed(`There's no ${rel} in this folder.`);
  let trashed: string | null;
  try {
    trashed = await trash(path.join(folder.path, rel));
  } catch (e) {
    return failed(`Couldn't move it to the Trash: ${(e as Error).message}`);
  }
  return { kind: "trashed", docs: docsUnder(folder, rel), trashed };
}

/** Bring back from the Trash what was trashed from `requested`, if its place is still free. */
export async function restoreEntry(
  folder: FolderState,
  requested: string,
  trashed: string,
  inTrash: (full: string) => boolean,
): Promise<{ kind: "restored"; path: string } | Failed> {
  if (folder.mode !== "writable") return failed("This folder is read-only.");
  const rel = checkPath(folder, requested);
  if (typeof rel !== "string") return rel;
  const name = path.posix.basename(rel);
  const backInFinder = `Find ${name} in the Trash and choose Put Back.`;
  if (!inTrash(trashed) || !(await exists(trashed)))
    return failed(`${name} is no longer where it was in the Trash. ${backInFinder}`);
  const full = path.join(folder.path, rel);
  if (await exists(full)) return failed(`There's a new ${name} in its place now.`);
  const parent = path.posix.dirname(rel);
  if (parent !== "." && !(await exists(path.dirname(full))))
    return failed(`The folder ${parent} is gone, so ${name} can't go back.`);
  try {
    await rename(trashed, full);
  } catch {
    return failed(`Anur couldn't take ${name} out of the Trash. ${backInFinder}`);
  }
  return { kind: "restored", path: rel };
}

/** "Plan.md", then "Plan copy.md", "Plan copy 2.md": the nth name to try in `dir`. */
function nthName(dir: string, name: string, isFolder: boolean, n: number): string {
  const ending = isFolder ? "" : path.posix.extname(name);
  const stem = name.slice(0, name.length - ending.length);
  const tail = n === 0 ? "" : n === 1 ? " copy" : ` copy ${String(n)}`;
  return `${dir ? `${dir}/` : ""}${stem}${tail}${ending}`;
}

/**
 * Copy files or folders from anywhere, as dropped or pasted from Finder, into
 * `into` ("" for the top). A name already there gets " copy", as Finder does.
 */
export async function copyInto(
  folder: FolderState,
  sources: readonly string[],
  into: string,
): Promise<{ kind: "copied"; paths: string[] } | Failed> {
  if (folder.mode !== "writable") return failed("This folder is read-only.");
  let dir = "";
  if (into !== "") {
    const checked = checkPath(folder, into);
    if (typeof checked !== "string") return checked;
    if (!isFolderIn(folder, checked)) return failed(`There's no folder ${checked}.`);
    dir = checked;
  }
  const dirFull = path.join(folder.path, dir);
  const paths: string[] = [];
  for (const source of sources) {
    const src = path.resolve(source);
    const name = path.basename(src);
    if (!name || name.startsWith(".")) continue;
    if (dirFull === src || dirFull.startsWith(src + path.sep))
      return failed(`${name} can't be copied inside itself.`);
    const isFolder = await lstat(src).then(
      (s) => s.isDirectory(),
      () => null,
    );
    if (isFolder === null) return failed(`${name} can't be read.`);
    let rel = "";
    for (let n = 0; n < 1000 && !rel; n++) {
      const tryRel = nthName(dir, name, isFolder, n);
      if (!(await exists(path.join(folder.path, tryRel)))) rel = tryRel;
    }
    if (!rel) return failed(`Too many copies of ${name}.`);
    try {
      await cp(src, path.join(folder.path, rel), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    } catch (e) {
      return failed(`Couldn't copy ${name}: ${(e as Error).message}`);
    }
    paths.push(rel);
  }
  return { kind: "copied", paths };
}
