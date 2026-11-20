import { homedir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MESSAGES, asClaudeCall, decide, toCopy, type HookConfig } from "./hook-rules.ts";

const folder = "/Users/p/Vault";
const config: HookConfig = {
  folder,
  anurDir: path.join(folder, ".anur"),
  thread: "t1",
  log: "/tmp/log",
  copies: "/support/copies/t1",
  copiesRoot: "/support/copies",
};
const resolve = (p: string, cwd: string) => path.resolve(cwd, p);
const call = (tool_name: string, tool_input: Record<string, unknown>) =>
  decide({ tool_name, tool_input, cwd: folder }, config, resolve)?.reason ?? null;
const bash = (command: string) => call("Bash", { command });

describe("the hook's file tools", () => {
  it("blocks reads and writes in .anur/, in any letter case", () => {
    expect(call("Read", { file_path: ".anur/docs/d/threads/x/dev.jsonl" })).toBe(MESSAGES.anur);
    expect(call("Write", { file_path: `${folder}/.ANUR/x` })).toBe(MESSAGES.anur);
  });

  it("sends every read and edit of a doc to this thread's working copy, made from the doc", () => {
    const d = decide(
      { tool_name: "Edit", tool_input: { file_path: "notes/plan.md" }, cwd: folder },
      config,
      resolve,
    );
    expect(d).toEqual({
      reason: toCopy("notes/plan.md", "/support/copies/t1/notes/plan.md"),
      copy: { from: `${folder}/notes/plan.md`, to: "/support/copies/t1/notes/plan.md" },
    });
    expect(call("Read", { file_path: "notes/plan.md" })).toBe(
      toCopy("notes/plan.md", "/support/copies/t1/notes/plan.md"),
    );
    expect(call("Write", { file_path: `${folder}/new.md` })).toBe(
      toCopy("new.md", "/support/copies/t1/new.md"),
    );
  });

  it("lets the agent use its own working copies, and keeps it out of other threads'", () => {
    expect(call("Edit", { file_path: "/support/copies/t1/notes/plan.md" })).toBeNull();
    expect(call("Read", { file_path: "/support/copies/t2/notes/plan.md" })).toBe(
      MESSAGES.otherCopy,
    );
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

  it("keeps the shell out of other threads' working copies, named or searched (30.14)", () => {
    expect(bash("cat /support/copies/t2/notes/plan.md")).toBe(MESSAGES.otherCopy);
    expect(bash("grep -n retry /support/copies/T2/plan.md")).toBe(MESSAGES.otherCopy);
    expect(bash("cat /support/copies/t1/notes/plan.md")).toBeNull();
    expect(bash("ls /support/copies")).toBeNull();
    expect(bash("rg secret /support")).toBe(MESSAGES.searchCopies);
    expect(bash("find / -name '*.md' -exec cat {} +")).toBe(MESSAGES.searchCopies);
    expect(bash("grep -rn retry /support/copies/t1")).toBeNull();
    expect(call("mcp__x__read", { path: "/support/copies/t2/a.md" })).toBe(MESSAGES.otherCopy);
  });

  it("reads a path the way the shell does: home for ~ and $HOME, an escaped space as part of the name", () => {
    const home = path.join(homedir(), "Library/Application Support/Anur/copies");
    const c = { ...config, copiesRoot: home, copies: path.join(home, "t1") };
    const sh = (command: string) =>
      decide({ tool_name: "Bash", tool_input: { command }, cwd: folder }, c, resolve)?.reason ??
      null;
    expect(sh("cat ~/Library/Application\\ Support/Anur/copies/t2/plan.md")).toBe(
      MESSAGES.otherCopy,
    );
    expect(sh("cat ~/Library/Application\\ Support/Anur/copies/t1/plan.md")).toBeNull();
    expect(sh('cat "$HOME/Library/Application Support/Anur/copies/t2/plan.md"')).toBe(
      MESSAGES.otherCopy,
    );
    expect(sh("cat ${HOME}/Library/Application\\ Support/Anur/copies/t2/plan.md")).toBe(
      MESSAGES.otherCopy,
    );
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

  it("lets shell writes onto a doc run, as an agent can in Obsidian; Anur adopts them afterwards", () => {
    expect(bash("echo hi >> notes/plan.md")).toBeNull();
    expect(bash("sed -i '' s/a/b/ plan.md")).toBeNull();
    expect(
      bash(`python3 -I - Notes.md <<'EOF'\nimport sys\np=sys.argv[1]\nopen(p,'w').write('x')\nEOF`),
    ).toBeNull();
    expect(bash("git diff plan.md")).toBeNull();
    expect(bash("cat plan.md")).toBeNull();
  });
});

describe("the hook and other tools", () => {
  it("blocks an MCP argument that points into .anur/", () => {
    expect(call("mcp__fs__read", { target: { path: ".anur/x" } })).toBe(MESSAGES.anur);
    expect(call("mcp__fs__read", { path: "notes/plan.md" })).toBeNull();
  });
});

describe("every home's .anur/ (18.15.2)", () => {
  const homes: HookConfig = {
    ...config,
    anurDirs: [path.join(folder, ".anur"), path.join(folder, "api", ".anur")],
  };
  const at = (tool_name: string, tool_input: Record<string, unknown>, cwd = folder) =>
    decide({ tool_name, tool_input, cwd }, homes, resolve)?.reason ?? null;

  it("closes a repo's .anur/ to the file tools, the shell and other tools, as the folder's", () => {
    expect(at("Read", { file_path: "api/.anur/docs/d/threads/x/dev.jsonl" })).toBe(MESSAGES.anur);
    expect(at("Edit", { file_path: `${folder}/api/.anur/decisions/sam.jsonl` })).toBe(
      MESSAGES.anur,
    );
    expect(at("Read", { file_path: ".anur/home-id" }, path.join(folder, "api"))).toBe(
      MESSAGES.anur,
    );
    expect(at("Bash", { command: "cat api/.anur/docs/d/threads/t/dev.jsonl" })).toBe(MESSAGES.anur);
    expect(at("mcp__x__read", { path: `${folder}/api/.anur/docs` })).toBe(MESSAGES.anur);
    // The repo's own code stays open.
    expect(at("Read", { file_path: "api/src/index.ts" })).toBeNull();
    expect(at("Bash", { command: "cat api/src/index.ts" })).toBeNull();
  });

  it("refuses a recursive read from a folder holding a repo's .anur/, unless it leaves .anur out", () => {
    expect(at("Bash", { command: "grep -rn retry api" })).toBe(MESSAGES.recursive);
    expect(at("Bash", { command: "grep -rn retry ." }, path.join(folder, "api"))).toBe(
      MESSAGES.recursive,
    );
    expect(at("Bash", { command: "grep -rn --exclude-dir=.anur retry api" })).toBeNull();
    // A recursive read inside the repo's code, below its .anur/, is fine.
    expect(at("Bash", { command: "grep -rn retry api/src" })).toBeNull();
  });

  it("still guards only the folder's .anur/ when no homes are given, as before", () => {
    expect(call("Read", { file_path: "api/.anur/x" })).toBeNull();
    expect(call("Read", { file_path: ".anur/x" })).toBe(MESSAGES.anur);
  });
});

describe("Kiro's tools, read as Claude Code's", () => {
  const kiro = (tool_name: string, tool_input: Record<string, unknown>) =>
    decide(asClaudeCall({ tool_name, tool_input, cwd: config.folder }), config, resolve);

  it("holds read_file, fs_write and str_replace to the file rules", () => {
    expect(kiro("read_file", { path: ".anur/docs/x.jsonl" })?.reason).toBe(MESSAGES.anur);
    expect(kiro("fs_write", { path: "plan.md", text: "x" })?.reason).toBe(
      toCopy("plan.md", path.join(config.copies, "plan.md")),
    );
    expect(kiro("str_replace", { path: "src/app.ts", oldStr: "a", newStr: "b" })).toBeNull();
  });

  it("holds execute_bash to the shell rules, and other tools to the .anur check", () => {
    expect(kiro("execute_bash", { command: "grep -rn secret ." })?.reason).toBe(MESSAGES.recursive);
    expect(kiro("execute_bash", { command: "rg secret" })).toBeNull();
    expect(kiro("web_fetch", { url: "https://example.com" })).toBeNull();
    expect(kiro("load_resource", { uri: path.join(config.folder, ".anur", "x") })?.reason).toBe(
      MESSAGES.anur,
    );
  });
});
