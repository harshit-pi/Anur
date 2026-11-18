import { execFile } from "node:child_process";

/**
 * Move to the system Trash and say where the item landed there, so Undo can
 * bring it back. Electron's own trashItem doesn't say, so this asks macOS
 * directly; null when it can't, and the caller trashes the plain way.
 */
const SCRIPT = `ObjC.import("Foundation");
function run(argv) {
  const out = $();
  const ok = $.NSFileManager.defaultManager.trashItemAtURLResultingItemURLError($.NSURL.fileURLWithPath(argv[0]), out, $());
  return ok ? ObjC.unwrap(out.path) : "";
}`;

export function trashTelling(full: string): Promise<string | null> {
  if (process.platform !== "darwin") return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(
      "osascript",
      ["-l", "JavaScript", "-e", SCRIPT, full],
      { timeout: 15_000 },
      (err, stdout) => {
        const place = stdout.trim();
        resolve(err || !place.startsWith("/") ? null : place);
      },
    );
  });
}

/** A path inside a Trash: the home Trash or another volume's. */
export const isInTrash = (full: string) => /\/\.Trash(es)?\//.test(full);
