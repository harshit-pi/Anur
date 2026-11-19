import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { ANUR_DIR, anurPaths } from "@anur/core";
import { writeFileAtomic } from "../../vault/anur-folder.ts";
import { IMAGE_TYPES } from "./images.ts";
import { readFile } from "../../vault/anur-copy.ts";

/**
 * `.anur/` upkeep (group 11): each device notes when it opened the folder
 * and when it last quit cleanly (11.4); Storage says what `.anur/` holds
 * (11.5); Clean up removes only snapshots nothing points to, and only when
 * no other device may still be writing; unused attachments are listed for
 * a person to review (11.6).
 */

/**
 * What a device last noted: when it opened the folder, when it quit cleanly
 * after, and the name of the person using it, shown on their threads.
 */
export type DeviceOpen = {
  device: string;
  openedAt: string;
  quitAt: string | null;
  name?: string | null;
};

const openFile = (folder: string, device: string) =>
  path.join(folder, ANUR_DIR, anurPaths.open(device));

export async function noteOpened(
  folder: string,
  device: string,
  now = new Date(),
  name: string | null = null,
): Promise<void> {
  const note: DeviceOpen = { device, openedAt: now.toISOString(), quitAt: null, name };
  await mkdir(path.dirname(openFile(folder, device)), { recursive: true });
  await writeFileAtomic(openFile(folder, device), `${JSON.stringify(note)}\n`);
}

export async function noteQuit(folder: string, device: string, now = new Date()): Promise<void> {
  const file = openFile(folder, device);
  let note: DeviceOpen;
  try {
    note = JSON.parse(await readFile(file, "utf8")) as DeviceOpen;
  } catch {
    return;
  }
  await writeFileAtomic(file, `${JSON.stringify({ ...note, quitAt: now.toISOString() })}\n`);
}

/** A person renamed themselves in Settings: their device's note says so from now on. */
export async function noteName(folder: string, device: string, name: string | null): Promise<void> {
  const file = openFile(folder, device);
  let note: DeviceOpen;
  try {
    note = JSON.parse(await readFile(file, "utf8")) as DeviceOpen;
  } catch {
    return;
  }
  await writeFileAtomic(file, `${JSON.stringify({ ...note, name })}\n`);
}

/** Each device's person, by device ID, from every device's note. */
export async function namesOf(folder: string): Promise<Map<string, string>> {
  const dir = path.join(folder, ANUR_DIR, "open");
  const out = new Map<string, string>();
  for (const n of await readdir(dir).catch(() => [] as string[])) {
    if (!n.endsWith(".json")) continue;
    try {
      const note = JSON.parse(await readFile(path.join(dir, n), "utf8")) as DeviceOpen;
      if (typeof note.name === "string" && note.name.trim()) out.set(note.device, note.name.trim());
    } catch {
      // A note being synced: its device shows without a name for now.
    }
  }
  return out;
}

/**
 * Other devices that have the folder open now, or didn't quit cleanly the
 * last time. One that opened it over 30 days ago and never came back is
 * left out: it can't be holding a reference to a snapshot that new.
 */
export async function devicesStillOpen(
  folder: string,
  device: string,
  now = new Date(),
): Promise<DeviceOpen[]> {
  const stale = now.getTime() - UNUSED_DAYS * 24 * 60 * 60 * 1000;
  const dir = path.dirname(openFile(folder, device));
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".json"));
  const out: DeviceOpen[] = [];
  for (const n of names) {
    try {
      const note = JSON.parse(await readFile(path.join(dir, n), "utf8")) as DeviceOpen;
      if (note.device === device) continue;
      if (Date.parse(note.openedAt) < stale) continue;
      if (!note.quitAt || note.quitAt < note.openedAt) out.push(note);
    } catch {
      // A note being synced, or written by a newer app: treat its device as open.
      out.push({ device: n.replace(/\.json$/, ""), openedAt: "", quitAt: null });
    }
  }
  return out;
}

export type StorageKind =
  "threads" | "history" | "previews" | "inputs" | "snapshots" | "section IDs" | "other";

async function walk(dir: string, each: (file: string, size: number, mtime: Date) => void) {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  for (const n of names) {
    const p = path.join(dir, n);
    const s = await stat(p).catch(() => null);
    if (!s) continue;
    if (s.isDirectory()) await walk(p, each);
    else each(p, s.size, s.mtime);
  }
}

function kindOf(rel: string): StorageKind {
  const parts = rel.split(path.sep);
  if (parts[0] === "snapshots") return "snapshots";
  if (parts[0] === "docs") {
    const k = parts[2];
    if (k === "threads") return "threads";
    if (k === "history") return "history";
    if (k === "previews") return "previews";
    if (k === "inputs") return "inputs";
    if (k === "ids") return "section IDs";
  }
  return "other";
}

/** What `.anur/` holds, by kind: bytes and file count. */
export async function storageOf(
  folder: string,
): Promise<{ kind: StorageKind; bytes: number; files: number }[]> {
  const root = path.join(folder, ANUR_DIR);
  const by = new Map<StorageKind, { bytes: number; files: number }>();
  await walk(root, (file, size) => {
    const k = kindOf(path.relative(root, file));
    const now = by.get(k) ?? { bytes: 0, files: 0 };
    by.set(k, { bytes: now.bytes + size, files: now.files + 1 });
  });
  const order: StorageKind[] = [
    "threads",
    "history",
    "snapshots",
    "previews",
    "inputs",
    "section IDs",
    "other",
  ];
  return order.flatMap((kind) => {
    const v = by.get(kind);
    return v ? [{ kind, ...v }] : [];
  });
}

/** Snapshots unused for this long, that nothing points to, are what Clean up removes. */
export const UNUSED_DAYS = 30;

const HASH = /\b[0-9a-f]{64}\b/g;

/**
 * Snapshots Clean up may remove: older than 30 days and named by no line
 * in `.anur/`. A hash is looked for in every record, whatever its kind, so
 * a record this app doesn't know yet still keeps its snapshot.
 */
export async function unusedSnapshots(
  folder: string,
  now = new Date(),
): Promise<{ hash: string; bytes: number }[]> {
  const root = path.join(folder, ANUR_DIR);
  const snapshots = path.join(root, "snapshots");
  const used = new Set<string>();
  const records: string[] = [];
  await walk(root, (file) => {
    if (!file.startsWith(snapshots + path.sep) && /\.(jsonl|json)$/.test(file)) records.push(file);
  });
  for (const f of records) {
    const text = await readFile(f, "utf8").catch(() => "");
    for (const m of text.matchAll(HASH)) used.add(m[0]);
  }
  const cutoff = now.getTime() - UNUSED_DAYS * 24 * 60 * 60 * 1000;
  const out: { hash: string; bytes: number }[] = [];
  const names = await readdir(snapshots).catch(() => [] as string[]);
  for (const n of names) {
    if (!/^[0-9a-f]{64}$/.test(n) || used.has(n)) continue;
    const s = await stat(path.join(snapshots, n)).catch(() => null);
    if (s?.isFile() && s.mtime.getTime() < cutoff) out.push({ hash: n, bytes: s.size });
  }
  return out;
}

/**
 * Images and attached files nothing uses (11.6): no doc names them, and no
 * input on a section or thread still points at them. Only listed; a person
 * reviews and deletes each one.
 */
export async function unusedAttachments(
  folder: string,
  docs: readonly string[],
  files: readonly string[],
): Promise<{ path: string; bytes: number }[]> {
  const root = path.join(folder, ANUR_DIR);
  // What inputs still point at: added inputs not removed since.
  const added = new Map<string, string>();
  const removed = new Set<string>();
  const inputFiles: string[] = [];
  await walk(path.join(root, "docs"), (file) => {
    if (file.endsWith(".jsonl") && /[\\/](inputs|threads)[\\/]/.test(file)) inputFiles.push(file);
  });
  const attached = new Set<string>();
  for (const f of inputFiles) {
    for (const line of (await readFile(f, "utf8").catch(() => "")).split("\n")) {
      if (!line.includes('"added-input"') && !line.includes('"input-removed"')) continue;
      try {
        const l = JSON.parse(line) as {
          kind: string;
          id: string;
          ref?: string;
          input?: string;
          source?: string;
        };
        if (l.kind === "added-input" && l.ref && l.source !== "link") {
          added.set(l.id, l.ref);
          if (l.source === "attachment") attached.add(l.ref);
        }
        if (l.kind === "input-removed" && l.input) removed.add(l.input);
      } catch {
        // A line cut off mid-write: skipped.
      }
    }
  }
  const pointed = new Set([...added].flatMap(([id, ref]) => (removed.has(id) ? [] : [ref])));
  const candidates = files.filter(
    (f) =>
      !pointed.has(f) && (attached.has(f) || Boolean(IMAGE_TYPES[path.extname(f).toLowerCase()])),
  );
  if (candidates.length === 0) return [];
  // Named by any doc: Obsidian links by file name, so the name alone counts.
  const texts = await Promise.all(
    docs.map((d) => readFile(path.join(folder, d), "utf8").catch(() => "")),
  );
  const all = texts.join("\n");
  const out: { path: string; bytes: number }[] = [];
  for (const f of candidates) {
    const name = path.basename(f);
    if (all.includes(name) || all.includes(encodeURI(name))) continue;
    const s = await stat(path.join(folder, f)).catch(() => null);
    if (s) out.push({ path: f, bytes: s.size });
  }
  return out;
}

/** Remove snapshots Clean up found, checking each again first. */
export async function removeSnapshots(
  folder: string,
  hashes: readonly string[],
  remove: (hash: string) => Promise<void>,
): Promise<number> {
  const still = new Set((await unusedSnapshots(folder)).map((s) => s.hash));
  let n = 0;
  for (const h of hashes) {
    if (!still.has(h)) continue;
    await remove(h);
    n++;
  }
  return n;
}
