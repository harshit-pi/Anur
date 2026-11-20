import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { installKiroHook, kiroHookInstalled, removeKiroHook } from "../../agent/kiro-hook.ts";
import type { McpEntry } from "../claude-skill/install.ts";

/**
 * Anur in the person's Kiro, all of it or none, as the Agents switch says:
 * the guard hook that lets Kiro run threads, the `anur` skill, and Anur's MCP
 * server, registered through Kiro's own CLI so Anur never edits its config.
 * Each launch rewrites whatever no longer matches the app.
 */

const run = (file: string, args: string[]) =>
  new Promise<string>((resolve, reject) => {
    execFile(file, args, { timeout: 20_000, encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim()));
      else resolve(stdout);
    });
  });

export class KiroInstall {
  constructor(
    private readonly d: {
      /** Anur's folder for Kiro, in the app's data. */
      dir: string;
      node: string;
      hook: string;
      /** The person's `kiro-cli`, or null. */
      kiro: () => Promise<string | null>;
      mcp: McpEntry;
      skillFiles: Readonly<Record<string, string>>;
      /** `~/.kiro/skills`, or a stand-in for checks. */
      skillsDir?: string;
    },
  ) {}

  private get skillDir() {
    return path.join(this.d.skillsDir ?? path.join(os.homedir(), ".kiro", "skills"), "anur");
  }

  private async skillCurrent(): Promise<boolean> {
    for (const [rel, text] of Object.entries(this.d.skillFiles))
      if ((await readFile(path.join(this.skillDir, rel), "utf8").catch(() => null)) !== text)
        return false;
    return true;
  }

  private async register(): Promise<void> {
    const kiro = await this.d.kiro();
    if (!kiro) throw new Error("Kiro CLI isn't installed on this computer.");
    const { command, args, env } = this.d.mcp;
    await run(kiro, [
      "mcp",
      "add",
      "--name",
      "anur",
      "--scope",
      "global",
      "--command",
      command,
      "--args",
      JSON.stringify(args),
      ...Object.entries(env).flatMap(([k, v]) => ["--env", `${k}=${v}`]),
      "--force",
    ]);
  }

  async add(): Promise<void> {
    await installKiroHook(this.d.dir, this.d.node, this.d.hook);
    await mkdir(this.skillDir, { recursive: true });
    for (const [rel, text] of Object.entries(this.d.skillFiles)) {
      await mkdir(path.dirname(path.join(this.skillDir, rel)), { recursive: true });
      await writeFile(path.join(this.skillDir, rel), text);
    }
    await this.register();
  }

  async remove(): Promise<void> {
    await removeKiroHook();
    await rm(this.skillDir, { recursive: true, force: true });
    const kiro = await this.d.kiro();
    if (kiro)
      await run(kiro, ["mcp", "remove", "--name", "anur", "--scope", "global"]).catch(
        () => undefined,
      );
  }

  /** On launch, for Kiro switched on: put back what no longer matches; returns what it fixed. */
  async check(): Promise<string[]> {
    const fixed: string[] = [];
    if (!(await kiroHookInstalled(this.d.dir, this.d.node, this.d.hook))) {
      await installKiroHook(this.d.dir, this.d.node, this.d.hook);
      fixed.push("hook");
    }
    if (!(await this.skillCurrent())) {
      await mkdir(this.skillDir, { recursive: true });
      for (const [rel, text] of Object.entries(this.d.skillFiles))
        await writeFile(path.join(this.skillDir, rel), text);
      fixed.push("skill");
    }
    return fixed;
  }

  /** Re-register the MCP server, as the app moved or updated; failures wait for the next launch. */
  async refreshMcp(): Promise<void> {
    await this.register().catch(() => undefined);
  }
}
