import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudeSkill, type McpEntry } from "./install.ts";
import { SKILL_FILES } from "./skill-files.ts";

/** A stand-in `claude` that keeps `mcp add-json` and `mcp remove` in a config file. */
async function fakeClaude(dir: string, config: string): Promise<string> {
  const bin = path.join(dir, "claude");
  await writeFile(
    bin,
    `#!/usr/bin/env node
const fs = require("fs");
const [, , mcp, verb, name, json] = process.argv;
let c = {};
try { c = JSON.parse(fs.readFileSync(${JSON.stringify(config)}, "utf8")); } catch {}
c.mcpServers ??= {};
if (verb === "remove") delete c.mcpServers[name];
if (verb === "add-json") c.mcpServers[name] = JSON.parse(json);
fs.writeFileSync(${JSON.stringify(config)}, JSON.stringify(c));
`,
    { mode: 0o755 },
  );
  return bin;
}

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function setup(
  entry: McpEntry = { type: "stdio", command: "/app/Anur", args: ["/app/mcp.js"], env: { A: "1" } },
) {
  const dir = await mkdtemp(path.join(tmpdir(), "anur-skill-"));
  dirs.push(dir);
  const claudeConfig = path.join(dir, ".claude.json");
  const bin = await fakeClaude(dir, claudeConfig);
  const make = (e: McpEntry) =>
    new ClaudeSkill({
      stateFile: path.join(dir, "support", "skill.json"),
      claudeDir: path.join(dir, ".claude"),
      claudeConfig,
      claude: () => Promise.resolve(bin),
      entry: e,
    });
  return { dir, claudeConfig, skill: make(entry), make };
}

describe("Anur in the person's Claude Code", () => {
  it("installs nothing until Add, then the skill and the MCP server", async () => {
    const { dir, skill } = await setup();
    expect(await skill.status()).toMatchObject({ added: false, current: false, claude: true });
    expect(await skill.check()).toEqual([]);
    await skill.add();
    expect(await readFile(path.join(dir, ".claude", "skills", "anur", "SKILL.md"), "utf8")).toBe(
      SKILL_FILES["SKILL.md"],
    );
    expect(await skill.status()).toMatchObject({ added: true, current: true });
  });

  it("repairs a corrupted or older skill file on the next check", async () => {
    const { dir, skill } = await setup();
    await skill.add();
    const file = path.join(dir, ".claude", "skills", "anur", "SKILL.md");
    await writeFile(file, "garbled");
    expect((await skill.status()).current).toBe(false);
    expect(await skill.check()).toEqual(["SKILL.md"]);
    expect(await readFile(file, "utf8")).toBe(SKILL_FILES["SKILL.md"]);
  });

  it("points the MCP server at the app again after the app moved", async () => {
    const { skill, make, claudeConfig } = await setup();
    await skill.add();
    const moved = make({
      type: "stdio",
      command: "/Applications/Anur",
      args: ["/Applications/mcp.js"],
      env: { A: "1" },
    });
    expect(await moved.check()).toEqual(["MCP server"]);
    const config = JSON.parse(await readFile(claudeConfig, "utf8")) as {
      mcpServers: Record<string, McpEntry>;
    };
    expect(config.mcpServers.anur?.command).toBe("/Applications/Anur");
  });

  it("never brings it back after Remove", async () => {
    const { dir, skill, claudeConfig } = await setup();
    await skill.add();
    await skill.remove();
    await mkdir(path.join(dir, ".claude"), { recursive: true });
    expect(await skill.check()).toEqual([]);
    const config = JSON.parse(await readFile(claudeConfig, "utf8")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(config.mcpServers.anur).toBeUndefined();
    expect(await skill.status()).toMatchObject({ added: false, dismissed: true });
  });
});
