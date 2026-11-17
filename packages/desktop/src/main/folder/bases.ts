import { open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { type BaseResult, type NoteFacts, propertiesOf, readBase } from "@anur/core";
import type { FolderState } from "../../shared/ipc-contract.ts";
import { listDocs } from "./list-docs.ts";

/**
 * An embedded base, `![[Ideas.base]]`, worked out for the page: the `.base`
 * file found the way Obsidian finds an embed, then every note's properties
 * read from the top of its file. Notes still in iCloud are left out, not
 * downloaded, and counted.
 */

export type BaseOutcome =
  | ({ kind: "base"; path: string; view: string | null; skipped: number } & BaseResult)
  | { kind: "failed"; reason: string };

/** Each note's facts by path, kept while its file is unchanged. */
const cache = new Map<string, { mtime: number; facts: NoteFacts }>();

/** Enough of a file to hold its frontmatter, nearly always. */
const HEAD = 32 * 1024;

async function factsOf(root: string, rel: string): Promise<NoteFacts | null> {
  const full = path.join(root, rel);
  try {
    const s = await stat(full);
    const key = `${root}\0${rel}`;
    const hit = cache.get(key);
    if (hit?.mtime === s.mtimeMs) return hit.facts;
    let text: string;
    const fh = await open(full, "r");
    try {
      const buf = Buffer.alloc(Math.min(HEAD, s.size));
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      text = buf.subarray(0, bytesRead).toString("utf8");
    } finally {
      await fh.close();
    }
    // Frontmatter longer than the head: read the whole file.
    if (s.size > HEAD && text.startsWith("---") && !/\n---[ \t]*\r?\n/.test(text.slice(3))) {
      text = await readFile(full, "utf8");
    }
    const facts = {
      path: rel,
      properties: propertiesOf(text),
      mtime: s.mtimeMs,
      ctime: s.birthtimeMs,
      size: s.size,
    };
    cache.set(key, { mtime: s.mtimeMs, facts });
    return facts;
  } catch {
    return null;
  }
}

/** The `.base` file an embed names: by its path, else by its name, nearest the page first. */
export async function findBase(root: string, target: string, from: string): Promise<string | null> {
  const name = target.toLowerCase().endsWith(".base") ? target : `${target}.base`;
  const { docs } = await listDocs(root, 5_000, ".base");
  const lower = name.toLowerCase().replace(/^\//, "");
  const here = from.includes("/") ? from.slice(0, from.lastIndexOf("/") + 1).toLowerCase() : "";
  const near = lower.includes("/") ? undefined : docs.find((d) => d.toLowerCase() === here + lower);
  const exact = docs.find((d) => d.toLowerCase() === lower);
  const byName = docs.find((d) => d.toLowerCase().endsWith(`/${lower}`));
  return near ?? exact ?? byName ?? null;
}

export async function readEmbeddedBase(
  folder: FolderState,
  target: string,
  from: string,
): Promise<BaseOutcome> {
  const hash = target.indexOf("#");
  const file = hash < 0 ? target : target.slice(0, hash);
  const view = hash < 0 ? null : target.slice(hash + 1) || null;
  const found = await findBase(folder.path, file, from);
  if (!found) return { kind: "failed", reason: `There's no ${file} in this folder.` };
  const full = path.resolve(folder.path, found);
  if (!full.startsWith(path.resolve(folder.path) + path.sep)) {
    return { kind: "failed", reason: "That base is outside this folder." };
  }
  let source: string;
  try {
    source = await readFile(full, "utf8");
  } catch {
    return { kind: "failed", reason: `${found} couldn't be read.` };
  }
  const offloaded = new Set(folder.offloaded);
  const wanted = folder.docs.filter((d) => !offloaded.has(d));
  const notes: NoteFacts[] = [];
  for (let i = 0; i < wanted.length; i += 64) {
    const batch = await Promise.all(wanted.slice(i, i + 64).map((d) => factsOf(folder.path, d)));
    for (const n of batch) if (n) notes.push(n);
  }
  return {
    kind: "base",
    path: found,
    view,
    skipped: folder.docs.length - wanted.length,
    ...readBase(source, notes),
  };
}
