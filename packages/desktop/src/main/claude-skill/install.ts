import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SKILL_FILES } from "./skill-files.ts";

/**
 * Anur in the person's Claude Code (6.1 to 6.3): the `/anur` skill in
 * `~/.claude/skills/anur/`, and Anur's MCP server registered in Claude
 * Code's user config through its own CLI, so Anur never edits that file.
 *
 * Nothing is installed without the person's Add. After that, every launch
 * checks the install: a skill file whose hash differs from the app's (a
 * newer app, or a corrupted file) is rewritten, and a registration pointing
 * at an old path (the app moved) is replaced. Remove is remembered: the
 * check never brings it back.
 */

export type SkillState = {
  /** The person added it, and hasn't removed it since. */
  added: boolean;
  /** They chose Not now on the first-launch card. */
  dismissed: boolean;
};

export type SkillStatus = SkillState & {
  /** Whether Claude Code is on this computer at all. */
  claude: boolean;
  /** Added, and the files and registration match the app's. */
  current: boolean;
};

export type McpEntry = {
  type: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
};

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const run = (file: string, args: string[]) =>
  new Promise<string>((resolve, reject) => {
    execFile(file, args, { timeout: 20_000, encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });

export class ClaudeSkill {
  constructor(
    private readonly d: {
      /** Where Anur keeps what the person chose, in app support. */
      stateFile: string;
      /** `~/.claude`, or a stand-in for checks. */
      claudeDir: string;
      /** `~/.claude.json`, where Claude Code keeps user-scoped MCP servers. */
      claudeConfig: string;
      /** The person's `claude`, or null when it isn't installed. */
      claude: () => Promise<string | null>;
      /** How Claude Code should start Anur's MCP server. */
      entry: McpEntry;
    },
  ) {}

  private get skillDir() {
    return path.join(this.d.claudeDir, "skills", "anur");
  }

  async state(): Promise<SkillState> {
    try {
      const s = JSON.parse(await readFile(this.d.stateFile, "utf8")) as Partial<SkillState>;
      return { added: s.added === true, dismissed: s.dismissed === true };
    } catch {
      return { added: false, dismissed: false };
    }
  }

  private async setState(s: SkillState): Promise<void> {
    await mkdir(path.dirname(this.d.stateFile), { recursive: true });
    await writeFile(this.d.stateFile, `${JSON.stringify(s)}\n`);
  }

  /** The skill files that differ from the app's: missing, changed or corrupted. */
  async staleFiles(): Promise<string[]> {
    const stale: string[] = [];
    for (const [rel, text] of Object.entries(SKILL_FILES)) {
      const now = await readFile(path.join(this.skillDir, rel), "utf8").catch(() => null);
      if (now === null || sha(now) !== sha(text)) stale.push(rel);
    }
    return stale;
  }

  /** Whether Claude Code's user config starts Anur's MCP server the way this app needs. */
  async registered(): Promise<boolean> {
    try {
      const config = JSON.parse(await readFile(this.d.claudeConfig, "utf8")) as {
        mcpServers?: Record<string, Partial<McpEntry>>;
      };
      const e = config.mcpServers?.anur;
      return (
        e?.command === this.d.entry.command &&
        JSON.stringify(e.args) === JSON.stringify(this.d.entry.args) &&
        JSON.stringify(e.env ?? {}) === JSON.stringify(this.d.entry.env)
      );
    } catch {
      return false;
    }
  }

  async status(): Promise<SkillStatus> {
    const s = await this.state();
    const claude = (await this.d.claude()) !== null;
    const current = s.added && (await this.staleFiles()).length === 0 && (await this.registered());
    return { ...s, claude, current };
  }

  private async writeFiles(only?: string[]): Promise<void> {
    await mkdir(this.skillDir, { recursive: true });
    for (const [rel, text] of Object.entries(SKILL_FILES)) {
      if (only && !only.includes(rel)) continue;
      await mkdir(path.dirname(path.join(this.skillDir, rel)), { recursive: true });
      await writeFile(path.join(this.skillDir, rel), text);
    }
  }

  private async register(): Promise<void> {
    const claude = await this.d.claude();
    if (!claude) throw new Error("Claude Code isn't installed on this computer.");
    // Replace any earlier entry; a missing one is fine.
    await run(claude, ["mcp", "remove", "anur", "--scope", "user"]).catch(() => undefined);
    await run(claude, ["mcp", "add-json", "anur", JSON.stringify(this.d.entry), "--scope", "user"]);
  }

  /** The person's Add: the skill's files, then the MCP server. */
  async add(): Promise<void> {
    await this.writeFiles();
    await this.register();
    await this.setState({ added: true, dismissed: true });
  }

  /** The person's Remove: both gone, and remembered so no check brings them back. */
  async remove(): Promise<void> {
    await rm(this.skillDir, { recursive: true, force: true });
    const claude = await this.d.claude();
    if (claude)
      await run(claude, ["mcp", "remove", "anur", "--scope", "user"]).catch(() => undefined);
    await this.setState({ added: false, dismissed: true });
  }

  async dismiss(): Promise<void> {
    const s = await this.state();
    await this.setState({ ...s, dismissed: true });
  }

  /**
   * On launch (6.3): when it was added, rewrite whatever no longer matches
   * the app. Returns what it repaired, for the log.
   */
  async check(): Promise<string[]> {
    if (!(await this.state()).added) return [];
    const repaired: string[] = [];
    const stale = await this.staleFiles();
    if (stale.length > 0) {
      await this.writeFiles(stale);
      repaired.push(...stale);
    }
    if (!(await this.registered())) {
      try {
        await this.register();
        repaired.push("MCP server");
      } catch {
        // Claude Code is gone or failing: the next launch tries again.
      }
    }
    return repaired;
  }
}

/**
 * Where Claude Code keeps its skills and user config: `~/.claude` and
 * `~/.claude.json`, or inside `CLAUDE_CONFIG_DIR` when the person set it,
 * as Claude Code itself does. Checks use it to stay off the real config.
 */
export function claudeHome() {
  const custom = process.env.CLAUDE_CONFIG_DIR;
  return custom
    ? { claudeDir: custom, claudeConfig: path.join(custom, ".claude.json") }
    : {
        claudeDir: path.join(os.homedir(), ".claude"),
        claudeConfig: path.join(os.homedir(), ".claude.json"),
      };
}
