import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { listDocs } from "./list-docs.ts";
import { readWebImage } from "./web-images.ts";

/**
 * An image a doc embeds (task 2.27), found the way Obsidian finds one:
 * beside the doc, by its path in the folder, in the folder's attachments
 * folder, then by its name anywhere in the folder. The page is sandboxed,
 * so main reads the file and hands it over as a data URL.
 */

export const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
};

/** Larger images are left as their chip: a data URL that big would stall the page. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export type ImageOutcome =
  { kind: "image"; path: string; dataUrl: string } | { kind: "failed"; reason: string };

const inside = (root: string, full: string) =>
  full === root || full.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

async function isFile(full: string): Promise<boolean> {
  try {
    return (await stat(full)).isFile();
  } catch {
    return false;
  }
}

/** Obsidian's setting for where new attachments go, if the folder has one. */
export async function attachmentFolder(root: string): Promise<string | null> {
  try {
    const raw = JSON.parse(await readFile(path.join(root, ".obsidian", "app.json"), "utf8")) as {
      attachmentFolderPath?: unknown;
    };
    return typeof raw.attachmentFolderPath === "string" ? raw.attachmentFolderPath : null;
  } catch {
    return null;
  }
}

/** The image's path in the folder, or null when it isn't there. */
export async function findImage(
  root: string,
  target: string,
  from: string,
): Promise<string | null> {
  const name = target.replace(/^\/+/, "");
  const ext = path.extname(name).toLowerCase();
  if (!IMAGE_TYPES[ext]) return null;
  const docDir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
  const attachments = await attachmentFolder(root);
  const candidates = [
    path.posix.join(docDir, name),
    name,
    ...(attachments === null || attachments === "/"
      ? []
      : attachments.startsWith("./")
        ? [path.posix.join(docDir, attachments.slice(2), name)]
        : [path.posix.join(attachments, name)]),
    path.posix.join("attachments", name),
  ];
  for (const rel of candidates) {
    const full = path.resolve(root, rel);
    if (inside(root, full) && (await isFile(full)))
      return path.relative(root, full).split(path.sep).join("/");
  }
  // By name anywhere in the folder, nearest the doc first.
  const { docs: files } = await listDocs(root, 20_000, ext);
  const lower = name.toLowerCase();
  const matches = files.filter((f) => {
    const l = f.toLowerCase();
    return l === lower || l.endsWith(`/${lower}`);
  });
  const here = docDir ? `${docDir.toLowerCase()}/` : "";
  return matches.find((f) => f.toLowerCase().startsWith(here)) ?? matches[0] ?? null;
}

export async function readImage(root: string, target: string, from: string): Promise<ImageOutcome> {
  if (/^https?:\/\//i.test(target)) {
    return readWebImage(target.trim());
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(target))
    return { kind: "failed", reason: "Only images in this folder or on the web are drawn." };
  let decoded = target;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    // Not percent-encoded: use it as written.
  }
  const found = await findImage(root, decoded, from);
  if (!found) return { kind: "failed", reason: `There's no ${decoded} in this folder.` };
  const full = path.resolve(root, found);
  const size = (await stat(full)).size;
  if (size > MAX_IMAGE_BYTES)
    return { kind: "failed", reason: `${found} is over 25 MB, so it's shown as its path.` };
  const type = IMAGE_TYPES[path.extname(full).toLowerCase()] ?? "application/octet-stream";
  const bytes = await readFile(full);
  return { kind: "image", path: found, dataUrl: `data:${type};base64,${bytes.toString("base64")}` };
}

const EXT_OF: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "image/bmp": ".bmp",
  "image/avif": ".avif",
};

/** Obsidian's name for a pasted image: `Pasted image 20261117143005.png`. */
export function pastedName(type: string, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${String(now.getFullYear())}${p(now.getMonth() + 1)}${p(now.getDate())}${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `Pasted image ${stamp}${EXT_OF[type] ?? ".png"}`;
}

/**
 * Where a pasted or dropped image goes, as Obsidian decides: its
 * attachments setting, "./" being beside the doc; with no setting, the
 * folder's top, Obsidian's default.
 */
export async function attachmentDir(root: string, from: string): Promise<string> {
  const setting = await attachmentFolder(root);
  const docDir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
  if (setting === null || setting === "/" || setting === "") return "";
  if (setting === "./") return docDir;
  if (setting.startsWith("./")) return path.posix.join(docDir, setting.slice(2));
  return setting.replace(/^\/+|\/+$/g, "");
}

export type SavedImage =
  { kind: "saved"; path: string; name: string } | { kind: "failed"; reason: string };

/** Save image bytes into the folder, never over a file that is there, and say where. */
export async function saveImage(
  root: string,
  from: string,
  wanted: string,
  type: string,
  bytes: Buffer,
): Promise<SavedImage> {
  const ext = EXT_OF[type];
  if (!ext) return { kind: "failed", reason: "That isn't an image Anur can keep." };
  if (bytes.length > MAX_IMAGE_BYTES)
    return { kind: "failed", reason: "That image is over 25 MB." };
  const base =
    path
      .basename(wanted)
      .replace(/[\\/:*?"<>|#^[\]]/g, " ")
      .trim() || pastedName(type);
  const named = IMAGE_TYPES[path.extname(base).toLowerCase()] ? base : `${base}${ext}`;
  const dir = await attachmentDir(root, from);
  const full = path.resolve(root, dir);
  if (!inside(root, full))
    return { kind: "failed", reason: "The attachments folder is outside this folder." };
  await mkdir(full, { recursive: true });
  const stem = named.slice(0, -path.extname(named).length);
  for (let n = 0; n < 1000; n++) {
    const name = n === 0 ? named : `${stem} ${String(n)}${path.extname(named)}`;
    try {
      await writeFile(path.join(full, name), bytes, { flag: "wx" });
      return { kind: "saved", path: path.posix.join(dir, name), name };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  return { kind: "failed", reason: "Too many images with that name." };
}
