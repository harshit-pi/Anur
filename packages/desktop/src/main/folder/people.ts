import { execFile } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ANUR_DIR, anurPaths } from "@anur/core";
import { readFile } from "../../vault/anur-copy.ts";
import { writeFileAtomic } from "../../vault/anur-folder.ts";

const run = promisify(execFile);

async function first(cmd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run(cmd, args, { timeout: 3000 });
    const v = stdout.trim();
    return v || null;
  } catch {
    return null;
  }
}

/**
 * The name others see on this person's threads: what they set in Settings,
 * else git's user.name for the folder, else their Mac account's full name.
 */
export async function personName(folder: string, chosen: string | null): Promise<string> {
  if (chosen?.trim()) return chosen.trim();
  return (
    (await first("git", ["-C", folder, "config", "user.name"])) ??
    (process.platform === "darwin" ? await first("id", ["-F"]) : null) ??
    os.userInfo().username
  );
}

/**
 * One person, as every Mac they use says (people): their handle, the same
 * key their decisions file has (GitHub login, else their email's hash), the
 * name they go by, and their devices. Each device writes only its own note,
 * `.anur/people/<device>.json`, committed with the folder so teammates see
 * names; `.anur/open/` stays on each Mac and never carries them.
 */
export type Person = { handle: string | null; name: string; devices: string[] };

type PersonNote = { device: string; handle: string | null; name: string; at: string };

const noteFile = (folder: string, device: string) =>
  path.join(folder, ANUR_DIR, anurPaths.person(device));

/** This device's person: written when it changes, so a folder's history stays quiet. */
export async function notePerson(
  folder: string,
  device: string,
  name: string,
  handle: string | null,
  now = new Date(),
): Promise<void> {
  const file = noteFile(folder, device);
  const was = await readFile(file, "utf8")
    .then((t) => JSON.parse(t) as PersonNote)
    .catch(() => null);
  if (was && was.name === name && was.handle === handle) return;
  const note: PersonNote = { device, handle, name, at: now.toISOString() };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFileAtomic(file, `${JSON.stringify(note)}\n`);
}

async function notes(folder: string): Promise<PersonNote[]> {
  const dir = path.join(folder, ANUR_DIR, "people");
  const out: PersonNote[] = [];
  for (const n of await readdir(dir).catch(() => [] as string[])) {
    if (!n.endsWith(".json")) continue;
    try {
      const note = JSON.parse(await readFile(path.join(dir, n), "utf8")) as PersonNote;
      if (typeof note.device === "string" && typeof note.name === "string" && note.name.trim())
        out.push({ ...note, name: note.name.trim(), handle: note.handle ?? null });
    } catch {
      // A note being synced: that device shows without a name for now.
    }
  }
  return out;
}

/** Everyone in the folder, one entry per handle; a device with no handle is its own person. */
export async function peopleIn(folder: string): Promise<Person[]> {
  const byKey = new Map<string, { person: Person; at: string }>();
  for (const n of await notes(folder)) {
    const key = n.handle ?? `device:${n.device}`;
    const seen = byKey.get(key);
    if (!seen) {
      byKey.set(key, { person: { handle: n.handle, name: n.name, devices: [n.device] }, at: n.at });
      continue;
    }
    seen.person.devices.push(n.device);
    // The name they set most recently, on whichever Mac.
    if (n.at > seen.at) {
      seen.person.name = n.name;
      seen.at = n.at;
    }
  }
  return [...byKey.values()].map((v) => v.person);
}

/** Each device's person's name, by device ID. */
export async function namesByDevice(folder: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const p of await peopleIn(folder)) for (const d of p.devices) out.set(d, p.name);
  return out;
}
