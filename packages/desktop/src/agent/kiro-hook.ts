import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Anur's hook in Kiro (spike, 2026-11-19): Kiro V3 runs every file in
 * ~/.kiro/hooks/ for every session, so Anur adds one file there. Its command
 * is a small script that exits at once unless the session carries ANUR_KIRO,
 * which only Anur's own Kiro process does: the person's sessions pay nothing
 * and are never touched.
 */

export const kiroHooksDir = () => path.join(os.homedir(), ".kiro", "hooks");
export const kiroHookFile = () => path.join(kiroHooksDir(), "anur.json");

/** Anur's folder for Kiro, in the app's own data. */
export const kiroDir = (userData: string) => path.join(userData, "kiro");

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** The script Kiro runs, and the hook file naming it. */
export function kiroHookFiles(dir: string, node: string, hook: string) {
  const script = path.join(dir, "guard.sh");
  const body = [
    "#!/bin/sh",
    "# Anur's guard for Kiro: only Anur's own sessions carry ANUR_KIRO.",
    '[ -n "$ANUR_KIRO" ] || exit 0',
    `ELECTRON_RUN_AS_NODE=1 exec ${q(node)} ${q(hook)} --kiro`,
    "",
  ].join("\n");
  const hooks = {
    version: "v1",
    hooks: [
      {
        name: "anur-thread-start",
        description: "Anur: marks the start of an Anur thread's session. Does nothing elsewhere.",
        trigger: "SessionStart",
        action: { type: "command", command: q(script) },
        timeout: 10,
      },
      {
        name: "anur-thread-guard",
        description: "Anur: keeps an Anur thread out of other threads. Does nothing elsewhere.",
        trigger: "PreToolUse",
        matcher: "*",
        action: { type: "command", command: q(script) },
        timeout: 10,
      },
    ],
  };
  return { script, body, hooks: `${JSON.stringify(hooks, null, 2)}\n` };
}

/** Whether Kiro has Anur's hook, pointing at this app's script as it is now. */
export async function kiroHookInstalled(dir: string, node: string, hook: string): Promise<boolean> {
  const want = kiroHookFiles(dir, node, hook);
  const [hooks, body] = await Promise.all([
    readFile(kiroHookFile(), "utf8").catch(() => null),
    readFile(want.script, "utf8").catch(() => null),
  ]);
  return hooks === want.hooks && body === want.body;
}

export async function installKiroHook(dir: string, node: string, hook: string): Promise<void> {
  const want = kiroHookFiles(dir, node, hook);
  await mkdir(path.join(dir, "sessions"), { recursive: true });
  await writeFile(want.script, want.body);
  await chmod(want.script, 0o755);
  await mkdir(kiroHooksDir(), { recursive: true });
  await writeFile(kiroHookFile(), want.hooks);
}

export async function removeKiroHook(): Promise<void> {
  await rm(kiroHookFile(), { force: true });
}
