import { randomBytes } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeviceId } from "@anur/core";
import { z } from "zod";

/**
 * This install's device ID (task 1.10): random, made once, and kept in Anur's
 * own app-support folder, never in the vault, so every copy of a vault on
 * another machine writes its own files.
 *
 * The check against the machine's hardware ID, which gives a restored or
 * copied machine a new ID, comes later with signed builds (group 13).
 */
const DeviceFile = z.object({ id: DeviceId, created: z.iso.datetime({ precision: 3 }) });

const FILE = "device.json";

/** 128 random bits in hex: safe as a file name, and never starting with "-". */
export function newDeviceId(): DeviceId {
  return DeviceId.parse(randomBytes(16).toString("hex"));
}

async function readDevice(file: string): Promise<DeviceId | null> {
  try {
    const parsed = DeviceFile.safeParse(JSON.parse(await readFile(file, "utf8")));
    return parsed.success ? parsed.data.id : null;
  } catch {
    return null;
  }
}

/**
 * Read this install's device ID, making it on first run. Two processes
 * starting at once agree on one ID: the file is published with a hard link,
 * which fails if another process got there first.
 */
export async function loadDeviceId(
  appSupportDir: string,
  now: () => number = Date.now,
): Promise<DeviceId> {
  const file = path.join(appSupportDir, FILE);
  const existing = await readDevice(file);
  if (existing) return existing;

  await mkdir(appSupportDir, { recursive: true, mode: 0o700 });
  const id = newDeviceId();
  const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ id, created: new Date(now()).toISOString() })}\n`, {
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
    return winner;
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
}
