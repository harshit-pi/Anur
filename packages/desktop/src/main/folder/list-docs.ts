import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * The folder's Markdown files, for the left sidebar: every `.md` file
 * outside dot-folders such as `.git`, `.anur` and `.obsidian`, outside
 * `node_modules`, and not ignored by git where the folder or a repo in it
 * says so (18.16). Paths are relative, with forward slashes, sorted the way
 * a person reads a tree: folders' files together, case ignored.
 */
export const MAX_DOCS = 20_000;

const SKIP_DIRS = new Set(["node_modules"]);

/**
 * Files the sidebar shows beside docs, the kinds Obsidian shows: images,
 * PDFs, audio, video, canvases and bases. Code and the rest stay hidden, so
 * a repo's sidebar stays a list of its writing.
 */
export const ATTACHMENT_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".bmp",
  ".avif",
  ".pdf",
  ".mp3",
  ".wav",
  ".m4a",
  ".ogg",
  ".flac",
  ".mp4",
  ".webm",
  ".mov",
  ".canvas",
  ".base",
]);

export async function listDocs(
  root: string,
  max = MAX_DOCS,
  ext = ".md",
): Promise<{ docs: string[]; truncated: boolean; folders: string[]; files: string[] }> {
  const docs: string[] = [];
  /** Attachments the sidebar shows, when listing Markdown docs. */
  const files: string[] = [];
  /** Folders worth showing: those holding docs at any depth, and empty ones, such as a new folder. */
  const folders: string[] = [];
  let truncated = false;
  /** What git ignores, from the folder: untracked files and folders a repo's ignore rules name. */
  const ignored = new Set<string>();
  const readIgnored = async (rel: string) => {
    for (const p of await gitIgnored(path.join(root, rel)))
      ignored.add((rel ? `${rel}/${p}` : p).normalize("NFC"));
  };

  /** Whether the folder holds a doc at any depth, or nothing at all. */
  async function walk(rel: string): Promise<boolean> {
    if (truncated) return false;
    let entries;
    try {
      entries = await readdir(path.join(root, rel), { withFileTypes: true });
    } catch {
      return false; // unreadable folder: skip it, as Obsidian does
    }
    // The folder itself, or a repo inside it: ask git once what it ignores.
    if (rel === "" || entries.some((e) => e.name === ".git")) await readIgnored(rel);
    let shown = entries.length === 0;
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (ignored.has(childRel.normalize("NFC"))) continue;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && (await walk(childRel))) {
          folders.push(childRel.normalize("NFC"));
          shown = true;
        }
      } else if (e.isFile() && e.name.toLowerCase().endsWith(ext)) {
        if (docs.length >= max) {
          truncated = true;
          return shown;
        }
        docs.push(childRel.normalize("NFC"));
        shown = true;
      } else if (
        e.isFile() &&
        ext === ".md" &&
        ATTACHMENT_EXTS.has(path.extname(e.name).toLowerCase()) &&
        files.length < max
      ) {
        files.push(childRel.normalize("NFC"));
        shown = true;
      }
    }
    return shown;
  }

  await walk("");
  const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
  docs.sort((a, b) => collator.compare(a, b));
  folders.sort((a, b) => collator.compare(a, b));
  files.sort((a, b) => collator.compare(a, b));
  return { docs, truncated, folders, files };
}

/**
 * The untracked files and folders git ignores in a folder, relative to it;
 * none outside a repo, or when git can't say. A whole ignored folder comes
 * back as one entry.
 */
export async function gitIgnored(dir: string): Promise<string[]> {
  try {
    const { stdout } = await run(
      "git",
      ["-C", dir, "ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"],
      { timeout: 10_000, maxBuffer: 64 * 1024 * 1024 },
    );
    return stdout
      .split("\0")
      .filter(Boolean)
      .map((p) => p.replace(/\/$/, ""));
  } catch {
    return [];
  }
}

/** Each doc or file's last change and creation times, in ms, for sorting the sidebar. */
export async function docTimes(
  root: string,
  docs: readonly string[],
): Promise<Record<string, [number, number]>> {
  const times: Record<string, [number, number]> = {};
  for (let i = 0; i < docs.length; i += 200) {
    await Promise.all(
      docs.slice(i, i + 200).map(async (d) => {
        try {
          const s = await stat(path.join(root, d));
          times[d] = [Math.round(s.mtimeMs), Math.round(s.birthtimeMs)];
        } catch {
          // Gone since it was listed: it sorts as oldest.
        }
      }),
    );
  }
  return times;
}
