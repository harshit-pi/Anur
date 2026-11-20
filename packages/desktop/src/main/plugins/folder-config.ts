import { mkdir, readdir, readFile, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { ANUR_DIR, anurPaths } from "@anur/core";
import { writeFileAtomic } from "../../vault/anur-folder.ts";

/**
 * A folder's plugins, kept in the folder (Plugins and Git mock, as Obsidian's
 * `.obsidian/plugins/`): `.anur/plugins/enabled.json` says which are on, and
 * `.anur/plugins/<id>.json` holds each one's settings. Committed with the
 * folder by default, so a teammate who opens it gets the same plugins set the
 * same way; a plugin's settings can be kept on this Mac instead, by a line in
 * `.anur/.gitignore`. Never a secret: logins stay with the tools that own them.
 */

export type Value = string | boolean;
export type FolderPlugins = { on: string[]; values: Record<string, Record<string, Value>> };

const dirOf = (folder: string) => path.join(folder, ANUR_DIR, "plugins");
const ignoreLine = (id: string) => `plugins/${id}.json`;

async function parse(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch {
    return null;
  }
}

/** One settings file; when iCloud left copies ("enabled 2.json"), the newest wins and the rest go. */
async function readJson(file: string): Promise<unknown> {
  const dir = path.dirname(file);
  const base = path.basename(file, ".json");
  const names = await readdir(dir).catch(() => [] as string[]);
  const copies = names.filter(
    (n) => n.startsWith(`${base} `) && /^ \d+\.json$/.test(n.slice(base.length)),
  );
  if (copies.length === 0) return parse(file);
  const found = await Promise.all(
    [path.basename(file), ...copies].map(async (n) => {
      const at = path.join(dir, n);
      const s = await stat(at).catch(() => null);
      return { at, time: s?.mtimeMs ?? -1, value: s ? await parse(at) : null };
    }),
  );
  const newest = found
    .filter((f) => typeof f.value === "object" && f.value !== null)
    .sort((a, b) => b.time - a.time)[0];
  if (!newest) return null;
  try {
    if (newest.at !== file) await rename(newest.at, file);
    for (const f of found)
      if (f.at !== file && f.at !== newest.at) await unlink(f.at).catch(() => undefined);
  } catch {
    // Read-only or moving underneath: the newest is still what this read returns.
  }
  return newest.value;
}

/** What a folder's files say, read fresh: after a pull, a teammate's change shows. */
export async function readFolderPlugins(folder: string): Promise<FolderPlugins> {
  const enabled = (await readJson(path.join(dirOf(folder), "enabled.json"))) as {
    on?: unknown;
  } | null;
  const on = Array.isArray(enabled?.on)
    ? enabled.on.filter(
        (x): x is string => typeof x === "string" && /^[a-z][a-z0-9-]{1,40}$/.test(x),
      )
    : [];
  const values: FolderPlugins["values"] = {};
  for (const id of on) {
    const raw = await readJson(path.join(dirOf(folder), `${id}.json`));
    if (raw && typeof raw === "object" && !Array.isArray(raw))
      values[id] = Object.fromEntries(
        Object.entries(raw).filter(
          (e): e is [string, Value] => typeof e[1] === "string" || typeof e[1] === "boolean",
        ),
      );
  }
  return { on: [...new Set(on)], values };
}

export async function writeEnabled(folder: string, on: readonly string[]): Promise<void> {
  await mkdir(dirOf(folder), { recursive: true });
  await writeFileAtomic(
    path.join(dirOf(folder), "enabled.json"),
    `${JSON.stringify({ on: [...new Set(on)].sort() }, null, 2)}\n`,
  );
}

export async function writeValues(
  folder: string,
  id: string,
  values: Record<string, Value>,
): Promise<void> {
  await mkdir(dirOf(folder), { recursive: true });
  const sorted = Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));
  await writeFileAtomic(
    path.join(dirOf(folder), `${id}.json`),
    `${JSON.stringify(sorted, null, 2)}\n`,
  );
}

const gitignoreOf = (folder: string) => path.join(folder, ANUR_DIR, anurPaths.gitignore());

/** Whether a plugin's settings are kept on this Mac, out of git. */
export async function keptOnMac(folder: string, id: string): Promise<boolean> {
  const text = await readFile(gitignoreOf(folder), "utf8").catch(() => "");
  return text.split("\n").some((l) => l.trim() === ignoreLine(id));
}

/** Keeps a plugin's settings on this Mac, or commits them again; the person's other lines stay. */
export async function setKeptOnMac(folder: string, id: string, onMac: boolean): Promise<void> {
  const text = await readFile(gitignoreOf(folder), "utf8").catch(() => "");
  const rows = text.split("\n").filter((l) => l.trim() !== ignoreLine(id));
  while (rows.length && rows.at(-1) === "") rows.pop();
  if (onMac) rows.push(ignoreLine(id));
  await mkdir(path.dirname(gitignoreOf(folder)), { recursive: true });
  await writeFileAtomic(gitignoreOf(folder), rows.length ? `${rows.join("\n")}\n` : "");
}
