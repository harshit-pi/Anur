import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * The person's own Claude Code and their shell's PATH. An app opened from
 * the Dock doesn't get the PATH a terminal has, so both are read from a
 * login shell; the adapter is then told which `claude` to run, because
 * otherwise it runs the copy bundled in its SDK (spike, 2026-11-17).
 */

const run = (file: string, args: string[], timeout = 8000) =>
  new Promise<string>((resolve, reject) => {
    execFile(file, args, { timeout, encoding: "utf8" }, (err, stdout) => {
      if (err) reject(new Error(err.message));
      else resolve(stdout);
    });
  });

const executable = async (p: string) => {
  try {
    await access(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** The PATH the person's login shell sets, falling back to this process's. */
export async function loginPath(): Promise<string> {
  const shell = process.env.SHELL ?? "/bin/zsh";
  try {
    const out = await run(shell, ["-ilc", 'printf "__ANUR__%s__ANUR__" "$PATH"']);
    const m = /__ANUR__(.*)__ANUR__/s.exec(out);
    if (m?.[1]) return m[1];
  } catch {
    // An unusual shell setup: keep this process's PATH.
  }
  return process.env.PATH ?? "/usr/bin:/bin";
}

/** Where `claude` is, or null when it isn't installed. */
export async function findClaude(pathEnv: string): Promise<string | null> {
  const forced = process.env.ANUR_CLAUDE;
  if (forced) return (await executable(forced)) ? forced : null;
  const home = os.homedir();
  const candidates = [
    ...pathEnv
      .split(path.delimiter)
      .filter(Boolean)
      .map((d) => path.join(d, "claude")),
    path.join(home, ".local", "bin", "claude"),
    path.join(home, ".claude", "local", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ];
  for (const c of candidates) if (await executable(c)) return c;
  return null;
}

export async function claudeVersion(claude: string): Promise<string | null> {
  try {
    return /\d+\.\d+\.\d+/.exec(await run(claude, ["--version"]))?.[0] ?? null;
  } catch {
    return null;
  }
}
