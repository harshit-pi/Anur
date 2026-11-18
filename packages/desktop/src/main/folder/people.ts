import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";

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
