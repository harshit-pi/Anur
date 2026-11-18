import { readdir, stat } from "node:fs/promises";
import path from "node:path";

/**
 * The folder's Markdown files, for the left sidebar: every `.md` file
 * outside dot-folders such as `.git`, `.anur` and `.obsidian`, and outside
 * `node_modules`. Paths are relative, with forward slashes, sorted the way a
 * person reads a tree: folders' files together, case ignored.
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

  /** Whether the folder holds a doc at any depth, or nothing at all. */
  async function walk(rel: string): Promise<boolean> {
    if (truncated) return false;
    let entries;
    try {
      entries = await readdir(path.join(root, rel), { withFileTypes: true });
    } catch {
      return false; // unreadable folder: skip it, as Obsidian does
    }
    let shown = entries.length === 0;
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
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
