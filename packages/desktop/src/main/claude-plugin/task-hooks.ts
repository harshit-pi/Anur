import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * The `anur` Claude Code plugin (group 21): two hooks, on each prompt and at
 * Stop, that mark the opened folder's repos and write the change report.
 * Anur keeps the plugin in its own app folder as a local marketplace, which
 * Claude Code reads in place, and installs it at user scope through
 * Claude Code's own CLI, so Anur never edits Claude Code's settings.
 *
 * A shell guard exits at once outside folders opened in Anur, so a prompt
 * anywhere else costs milliseconds. Nothing is installed without the
 * person's Add; a launch rewrites files that no longer match the app.
 */

export const MARKETPLACE = "anur-app";
export const PLUGIN = "anur";

export type TaskHooksStatus = { claude: boolean; added: boolean; current: boolean };

const run = (file: string, args: string[]) =>
  new Promise<string>((resolve, reject) => {
    execFile(file, args, { timeout: 60_000, encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim()));
      else resolve(stdout);
    });
  });

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** The plugin's files, relative to the marketplace folder. */
export function pluginFiles(node: string, cli: string): Record<string, string> {
  const hook = (timeout: number) => ({
    hooks: [{ type: "command", command: '"${CLAUDE_PLUGIN_ROOT}"/scripts/task-hook.sh', timeout }],
  });
  return {
    ".claude-plugin/marketplace.json": JSON.stringify(
      {
        name: MARKETPLACE,
        description: "Anur's own plugin, kept by the Anur app on this Mac.",
        owner: { name: "Anur" },
        plugins: [{ name: PLUGIN, source: `./${PLUGIN}`, description: "Anur's task reports" }],
      },
      null,
      2,
    ),
    [`${PLUGIN}/.claude-plugin/plugin.json`]: JSON.stringify(
      {
        name: PLUGIN,
        version: "1.0.0",
        displayName: "Anur",
        description:
          "After each task in a folder opened in Anur, what it changed across repos, ranked by risk, with Claude's own choices.",
        author: { name: "Anur" },
      },
      null,
      2,
    ),
    [`${PLUGIN}/README.md`]: `# Anur

After each task in a folder opened in Anur, Anur reports what the task changed across the folder's repos, ranked data, auth, calls, then UI, with Claude's own choices.

- On each prompt, it marks every repo in the folder; at Stop, it compares and writes the report to the folder's \`.anur/tasks/\`.
- Outside folders opened in Anur, the hooks exit at once and do nothing.
- Added and removed from Anur's Settings, under Plugins.
`,
    [`${PLUGIN}/hooks/hooks.json`]: JSON.stringify(
      { hooks: { UserPromptSubmit: [hook(30)], Stop: [hook(60)] } },
      null,
      2,
    ),
    [`${PLUGIN}/scripts/task-hook.sh`]: `#!/bin/sh
# Anur's task hooks. Outside folders opened in Anur they exit at once.
d="\${CLAUDE_PROJECT_DIR:-$PWD}"
found=""
while [ "$d" != "/" ] && [ "$d" != "$HOME" ] && [ -n "$d" ]; do
  [ -d "$d/.anur" ] && found=1
  d=$(dirname "$d")
done
if [ -z "$found" ]; then cat >/dev/null; exit 0; fi
ELECTRON_RUN_AS_NODE=1 exec ${q(node)} ${q(cli)} hook
`,
  };
}

type Deps = {
  /** Where Anur keeps the marketplace folder, in app support. */
  dir: string;
  /** Where Anur remembers the person's Add. */
  stateFile: string;
  claude: () => Promise<string | null>;
  /** Electron, run as Node, and the bundled `anur-system` CLI. */
  node: string;
  cli: string;
};

export class TaskHooks {
  private readonly d: Deps;
  constructor(d: Deps) {
    this.d = d;
  }

  private files() {
    return pluginFiles(this.d.node, this.d.cli);
  }

  private async added(): Promise<boolean> {
    try {
      return (
        (JSON.parse(await readFile(this.d.stateFile, "utf8")) as { added?: boolean }).added === true
      );
    } catch {
      return false;
    }
  }

  private async setAdded(added: boolean) {
    await mkdir(path.dirname(this.d.stateFile), { recursive: true });
    await writeFile(this.d.stateFile, `${JSON.stringify({ added })}\n`);
  }

  /** Files that differ from the app's, such as after the app moved or updated. */
  async stale(): Promise<string[]> {
    const out: string[] = [];
    for (const [rel, text] of Object.entries(this.files())) {
      const now = await readFile(path.join(this.d.dir, rel), "utf8").catch(() => null);
      if (now !== text) out.push(rel);
    }
    return out;
  }

  private async write(only?: string[]) {
    for (const [rel, text] of Object.entries(this.files())) {
      if (only && !only.includes(rel)) continue;
      const f = path.join(this.d.dir, rel);
      await mkdir(path.dirname(f), { recursive: true });
      await writeFile(f, text);
      if (f.endsWith(".sh")) await chmod(f, 0o755);
    }
  }

  async status(): Promise<TaskHooksStatus> {
    const claude = (await this.d.claude()) !== null;
    const added = await this.added();
    return { claude, added, current: added && (await this.stale()).length === 0 };
  }

  /** The person's Add: the files, the marketplace, the plugin at user scope. */
  async add(): Promise<void> {
    const claude = await this.d.claude();
    if (!claude) throw new Error("Claude Code isn't installed on this computer.");
    await this.write();
    await run(claude, ["plugin", "marketplace", "add", this.d.dir, "--scope", "user"]);
    await run(claude, ["plugin", "install", `${PLUGIN}@${MARKETPLACE}`, "--scope", "user"]);
    await this.setAdded(true);
  }

  /** The person's Remove: the plugin and its marketplace, and the files. */
  async remove(): Promise<void> {
    const claude = await this.d.claude();
    if (claude) {
      await run(claude, [
        "plugin",
        "uninstall",
        `${PLUGIN}@${MARKETPLACE}`,
        "--scope",
        "user",
      ]).catch(() => undefined);
      await run(claude, ["plugin", "marketplace", "remove", MARKETPLACE]).catch(() => undefined);
    }
    await rm(this.d.dir, { recursive: true, force: true });
    await this.setAdded(false);
  }

  /** On launch: rewrite what no longer matches; Claude Code reads the folder in place. */
  async check(): Promise<string[]> {
    if (!(await this.added())) return [];
    const stale = await this.stale();
    if (stale.length) await this.write(stale);
    return stale;
  }
}
