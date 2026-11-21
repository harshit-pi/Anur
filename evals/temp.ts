/**
 * A temp folder for an eval run, removed when the process exits, however it
 * exits. ANUR_EVAL_KEEP=1 keeps them, to look inside after a failure.
 */
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const made: string[] = [];
let hooked = false;

export async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  made.push(dir);
  if (!hooked && process.env.ANUR_EVAL_KEEP !== "1") {
    hooked = true;
    process.on("exit", () => {
      for (const d of made) rmSync(d, { recursive: true, force: true });
    });
  }
  return dir;
}
