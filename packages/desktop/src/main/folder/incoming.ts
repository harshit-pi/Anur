import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * What another app drags or pastes into the files panel, made into files in
 * the folder: real files, file addresses and paths, Obsidian's links and
 * copied notes (resolved through its own list of vaults), and otherwise the
 * text itself, as a new doc.
 */
export type Incoming = { uriList: string; text: string; obsidianFiles: string };
export type Vault = { name: string; path: string; open: boolean };

const exists = (full: string) =>
  lstat(full).then(
    () => true,
    () => false,
  );

/** The vaults Obsidian knows on this Mac, from its own settings file. */
export async function obsidianVaults(appData: string): Promise<Vault[]> {
  try {
    const raw = JSON.parse(
      await readFile(path.join(appData, "obsidian", "obsidian.json"), "utf8"),
    ) as { vaults?: Record<string, { path?: unknown; open?: unknown }> };
    return Object.values(raw.vaults ?? {}).flatMap((v) =>
      typeof v.path === "string"
        ? [{ name: path.basename(v.path), path: v.path, open: v.open === true }]
        : [],
    );
  } catch {
    return [];
  }
}

/** The file an `obsidian://open` link names, if its vault is on this Mac. */
async function obsidianLink(url: URL, vaults: Vault[]): Promise<string | null> {
  const direct = url.searchParams.get("path");
  if (direct) return (await exists(direct)) ? direct : null;
  const name = url.searchParams.get("vault");
  const file = url.searchParams.get("file");
  if (!name || !file) return null;
  for (const v of vaults.filter((x) => x.name === name)) {
    for (const rel of [file, `${file}.md`]) {
      const full = path.join(v.path, rel);
      if (full.startsWith(v.path + path.sep) && (await exists(full))) return full;
    }
  }
  return null;
}

/**
 * The files the incoming data names, or else its text. Obsidian's copied
 * notes are vault-relative, so the open vaults that hold them are used first.
 */
export async function resolveIncoming(
  incoming: Incoming,
  vaults: Vault[],
): Promise<{ paths: string[]; text: string | null }> {
  const paths: string[] = [];
  try {
    const copied = JSON.parse(incoming.obsidianFiles || "null") as { paths?: unknown } | null;
    const rels = Array.isArray(copied?.paths)
      ? copied.paths.filter((p): p is string => typeof p === "string")
      : [];
    const ordered = [...vaults.filter((v) => v.open), ...vaults.filter((v) => !v.open)];
    for (const rel of rels) {
      for (const v of ordered) {
        const full = path.join(v.path, rel);
        if (full.startsWith(v.path + path.sep) && (await exists(full))) {
          paths.push(full);
          break;
        }
      }
    }
  } catch {
    // Not Obsidian's copy: read the rest.
  }
  const lines = (incoming.uriList || incoming.text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  for (const line of paths.length ? [] : lines) {
    try {
      const url = new URL(line);
      if (url.protocol === "file:") {
        const full = fileURLToPath(url);
        if (await exists(full)) paths.push(full);
      } else if (url.protocol === "obsidian:") {
        const full = await obsidianLink(url, vaults);
        if (full) paths.push(full);
      }
    } catch {
      // Not an address; a plain path, perhaps.
      if (line.startsWith("/") && (await exists(line))) paths.push(line);
    }
  }
  if (paths.length) return { paths: [...new Set(paths)], text: null };
  const text = incoming.text.trim() || incoming.uriList.trim();
  return { paths: [], text: text || null };
}

/** A name for a doc made from text: its first line, without Markdown marks. */
export function nameFromText(text: string): string {
  const first =
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean) ?? "";
  const plain = first
    .replace(/^#+\s*|^[-*>]\s+|[*_`[\]]/g, "")
    .replace(/https?:\/\/(www\.)?/, "")
    .replace(/[\\/:]+/g, " ")
    .replace(/^\.+/, "")
    .replace(/\s+/g, " ")
    .trim();
  const cut = plain.length > 50 ? plain.slice(0, 50).replace(/\s+\S*$/, "") : plain;
  return cut || "Pasted text";
}

/** Write `text` as a new doc in `dirFull`; "Name.md", then "Name 2.md". Returns its file name. */
export async function docFromText(dirFull: string, text: string): Promise<string> {
  const name = nameFromText(text);
  for (let n = 1; n < 1000; n++) {
    const file = `${name}${n === 1 ? "" : ` ${String(n)}`}.md`;
    try {
      await writeFile(path.join(dirFull, file), text.endsWith("\n") ? text : `${text}\n`, {
        flag: "wx",
      });
      return file;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  throw new Error("Too many docs with that name.");
}
