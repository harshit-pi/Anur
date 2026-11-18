import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { link, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeviceId } from "@anur/core";
import { z } from "zod";

/**
 * This install's device ID (task 1.10): random, made once, and kept in Anur's
 * own app-support folder, never in the vault, so every copy of a vault on
 * another machine writes its own files.
 *
 * Beside it sits a hash of the Mac's hardware ID (13.2). When the two no
 * longer match at start, as on a Mac restored from another's backup or a
 * copied home folder, a new device ID is made, so two machines never write
 * as one.
 */
const DeviceFile = z.object({
  id: DeviceId,
  created: z.iso.datetime({ precision: 3 }),
  /** A hash of the machine's hardware ID; missing in files from before 13.2. */
  machine: z.string().optional(),
});
type DeviceFile = z.infer<typeof DeviceFile>;

const FILE = "device.json";

/** 128 random bits in hex: safe as a file name, and never starting with "-". */
export function newDeviceId(): DeviceId {
  return DeviceId.parse(randomBytes(16).toString("hex"));
}

/** A hash of this Mac's hardware UUID, never the UUID itself; null elsewhere or if unread. */
export function hardwareHash(): Promise<string | null> {
  if (process.platform !== "darwin") return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(
      "/usr/sbin/ioreg",
      ["-rd1", "-c", "IOPlatformExpertDevice"],
      { timeout: 5000 },
      (err, out) => {
        const uuid = /"IOPlatformUUID" = "([^"]+)"/.exec(out)?.[1];
        resolve(
          err || !uuid
            ? null
            : createHash("sha256").update(`anur-device:${uuid}`).digest("hex").slice(0, 32),
        );
      },
    );
  });
}

async function readDevice(file: string): Promise<DeviceFile | null> {
  try {
    const parsed = DeviceFile.safeParse(JSON.parse(await readFile(file, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Replace the device file whole, so a reader never sees half of it. */
async function replaceDevice(file: string, device: DeviceFile): Promise<void> {
  const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmp, `${JSON.stringify(device)}\n`, { mode: 0o600 });
  await rename(tmp, file);
}

/**
 * Read this install's device ID, making it on first run. Two processes
 * starting at once agree on one ID: the file is published with a hard link,
 * which fails if another process got there first.
 */
export async function loadDeviceId(
  appSupportDir: string,
  now: () => number = Date.now,
  machine: () => Promise<string | null> = hardwareHash,
): Promise<DeviceId> {
  const file = path.join(appSupportDir, FILE);
  const here = await machine();
  const existing = await readDevice(file);
  if (existing) {
    // Unknown machine, or a file from before the check: the ID stays, and learns this Mac.
    if (!here || existing.machine === here) return existing.id;
    if (!existing.machine) {
      await replaceDevice(file, { ...existing, machine: here });
      return existing.id;
    }
    // Another Mac's ID, carried here by a restore or a copy: this Mac gets its own.
    const fresh = { id: newDeviceId(), created: new Date(now()).toISOString(), machine: here };
    await replaceDevice(file, fresh);
    return fresh.id;
  }

  await mkdir(appSupportDir, { recursive: true, mode: 0o700 });
  const id = newDeviceId();
  const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  const made = { id, created: new Date(now()).toISOString(), ...(here ? { machine: here } : {}) };
  await writeFile(tmp, `${JSON.stringify(made)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  try {
    await link(tmp, file);
    return id;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    const winner = await readDevice(file);
    if (!winner)
      throw new Error(`${file} exists but can't be read; move it aside to make a new device ID`, {
        cause: e,
      });
    return winner.id;
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
}
