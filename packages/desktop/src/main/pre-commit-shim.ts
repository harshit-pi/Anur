import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * The script a repo's pre-commit hook calls (23.6), at the same path on
 * every Mac, `~/.anur/bin/anur-pre-commit`, so a hook line committed with
 * the repo works for anyone with Anur and is skipped by anyone without it.
 * The app keeps it pointing at itself: the released app always, a dev build
 * only when there's none or the app it names is gone. It runs the bundled
 * CLI with the app's own Electron as Node, and never fails a commit.
 */

export const shimPath = (home = os.homedir()) => path.join(home, ".anur", "bin", "anur-pre-commit");

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function shimText(app: string, cli: string): string {
  return [
    "#!/bin/sh",
    "# Anur's pre-commit step: the CLAUDE.md block from the staged decisions.",
    "# Made by Anur and kept pointing at the installed app; it never stops a commit.",
    `APP=${quote(app)}`,
    `CLI=${quote(cli)}`,
    // Only the app is checked: the CLI sits inside its app.asar, which only Electron can read.
    '[ -x "$APP" ] || exit 0',
    'ELECTRON_RUN_AS_NODE=1 "$APP" "$CLI" claude-md "$(git rev-parse --show-toplevel)" --stage >/dev/null 2>&1 || true',
    "exit 0",
    "",
  ].join("\n");
}

/** The app a shim names, or null when it can't be read. */
function appIn(text: string): string | null {
  const m = /^APP='((?:[^']|'\\'')*)'$/m.exec(text);
  return m?.[1]?.replace(/'\\''/g, "'") ?? null;
}

/** Write the shim; whether it was written. */
export async function writeShim(opts: {
  app: string;
  cli: string;
  /** The released app always points it at itself; a dev build only takes an empty or stale one. */
  release: boolean;
  home?: string;
}): Promise<boolean> {
  const file = shimPath(opts.home);
  const want = shimText(opts.app, opts.cli);
  const now = await readFile(file, "utf8").catch(() => null);
  if (now === want) return false;
  if (now !== null && !opts.release) {
    const named = appIn(now);
    // A shim naming this very app is always brought up to date.
    const alive =
      named && named !== opts.app
        ? await stat(named).then(
            () => true,
            () => false,
          )
        : false;
    if (alive) return false;
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, want);
  await chmod(file, 0o755);
  return true;
}
