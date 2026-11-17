import path from "node:path";
import { describe, expect, it } from "vitest";
import { MESSAGES, decide, type HookConfig } from "./hook-rules.ts";

const folder = "/Users/p/Vault";
const config: HookConfig = {
  folder,
  anurDir: path.join(folder, ".anur"),
  thread: "t1",
  log: "/tmp/log",
};
const resolve = (p: string, cwd: string) => path.resolve(cwd, p);
const call = (tool_name: string, tool_input: Record<string, unknown>) =>
  decide({ tool_name, tool_input, cwd: folder }, config, resolve);
const bash = (command: string) => call("Bash", { command });

describe("the hook's file tools", () => {
  it("blocks reads and writes in .anur/, in any letter case", () => {
    expect(call("Read", { file_path: ".anur/docs/d/threads/x/dev.jsonl" })).toBe(MESSAGES.anur);
    expect(call("Write", { file_path: `${folder}/.ANUR/x` })).toBe(MESSAGES.anur);
  });

  it("lets the agent read any doc, and stops it writing one", () => {
    expect(call("Read", { file_path: "notes/plan.md" })).toBeNull();
    expect(call("Edit", { file_path: "notes/plan.md" })).toBe(MESSAGES.docWrite);
    expect(call("Write", { file_path: `${folder}/new.md` })).toBe(MESSAGES.docWrite);
  });

  it("leaves the person's other files alone: instruction files, dot-folders and code", () => {
    expect(call("Edit", { file_path: "CLAUDE.md" })).toBeNull();
    expect(call("Write", { file_path: ".claude/skills/x/SKILL.md" })).toBeNull();
    expect(call("Edit", { file_path: "src/app.ts" })).toBeNull();
    expect(call("Write", { file_path: "/tmp/out.md" })).toBeNull();
  });
});

describe("the hook's shell rules", () => {
  it("blocks naming .anur/, but lets the agent size or list it", () => {
    expect(bash("cat .anur/docs/d/threads/t2/dev.jsonl")).toBe(MESSAGES.anur);
    expect(bash("du -sh .anur")).toBeNull();
  });

  it("blocks a recursive read from a root that holds .anur/, unless it excludes it", () => {
    expect(bash("grep -rn retry .")).toBe(MESSAGES.recursive);
    expect(bash("grep -rn retry")).toBe(MESSAGES.recursive);
    expect(bash("grep -rn retry --exclude-dir=.anur .")).toBeNull();
    expect(bash("grep -rn retry notes/")).toBeNull();
    expect(bash("find . -name '*.md' | xargs cat")).toBe(MESSAGES.recursive);
    expect(bash("rg -uu secret")).toBe(MESSAGES.recursive);
  });

  it("lets rg and git grep search, since they skip .anur/ by its ignore files", () => {
    expect(bash("rg retry")).toBeNull();
    expect(bash("git grep retry")).toBeNull();
  });

  it("blocks git clean -x unless it keeps .anur", () => {
    expect(bash("git clean -xfd")).toBe(MESSAGES.gitClean);
    expect(bash("git clean -xfd -e .anur")).toBeNull();
    expect(bash("git clean -fd")).toBeNull();
  });

  it("blocks shell writes onto a doc, and lets git that only reads run", () => {
    expect(bash("echo hi >> notes/plan.md")).toBe(MESSAGES.docWrite);
    expect(bash("sed -i '' s/a/b/ plan.md")).toBe(MESSAGES.docWrite);
    expect(bash("rm plan.md")).toBe(MESSAGES.docWrite);
    expect(bash("git mv plan.md old.md")).toBe(MESSAGES.docWrite);
    expect(bash("git diff plan.md")).toBeNull();
    expect(bash("cat plan.md")).toBeNull();
    expect(bash("echo hi > /tmp/x.md")).toBeNull();
  });
});

describe("the hook and other tools", () => {
  it("blocks an MCP argument that points into .anur/", () => {
    expect(call("mcp__fs__read", { target: { path: ".anur/x" } })).toBe(MESSAGES.anur);
    expect(call("mcp__fs__read", { path: "notes/plan.md" })).toBeNull();
  });
});
