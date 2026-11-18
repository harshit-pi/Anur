import { describe, expect, it } from "vitest";
import { classify, readsOnly, outputText } from "./inputs.ts";

const at = { folder: "/f", copies: "/app/copies/t1", doc: "plan.md" };

describe("what the agent picked up", () => {
  it("keeps a file it read, with its content", () => {
    expect(
      classify({
        ...at,
        name: "Read",
        input: { file_path: "/f/notes/comp.txt" },
        output: "Splitwise",
      }),
    ).toEqual({
      source: "file",
      local: false,
      label: "notes/comp.txt",
      ref: "notes/comp.txt",
      text: "Splitwise",
      trust: "trusted",
    });
  });

  it("keeps another doc as a pointer, and never the thread's own doc or working copy", () => {
    expect(
      classify({ ...at, name: "Read", input: { file_path: "/f/other.md" }, output: "x" }),
    ).toMatchObject({
      source: "doc",
      text: null,
    });
    expect(
      classify({ ...at, name: "Read", input: { file_path: "/f/plan.md" }, output: "x" }),
    ).toBeNull();
    expect(
      classify({
        ...at,
        name: "Read",
        input: { file_path: "/app/copies/t1/plan.md" },
        output: "x",
      }),
    ).toBeNull();
  });

  it("keeps a command's output, and a fetch's answer as untrusted", () => {
    expect(
      classify({ ...at, name: "Bash", input: { command: "gh pr view 12" }, output: "Fix retries" }),
    ).toMatchObject({ source: "command", label: "$ gh pr view 12", trust: "trusted" });
    expect(
      classify({
        ...at,
        name: "WebFetch",
        input: { url: "https://example.com", prompt: "Title?" },
        output: "Example Domain",
      }),
    ).toMatchObject({ source: "fetch", trust: "untrusted" });
  });

  it("labels another MCP server's result by server, and leaves out Anur's own tools and edits", () => {
    expect(
      classify({
        ...at,
        name: "mcp__linear__get_issue",
        input: { id: "A-1" },
        output: [{ type: "text", text: "Retry bug" }],
      }),
    ).toMatchObject({ source: "mcp", label: "linear: get_issue" });
    expect(
      classify({ ...at, name: "mcp__anur__anur_read_section", input: {}, output: "x" }),
    ).toBeNull();
    expect(
      classify({ ...at, name: "Edit", input: { file_path: "/f/a.txt" }, output: "ok" }),
    ).toBeNull();
  });

  it("keeps what came from the machine outside the folder on this device only", () => {
    const read = (file_path: string) =>
      classify({ ...at, name: "Read", input: { file_path }, output: "x" });
    expect(read("/Users/x/.claude/projects/p/notes.md")).toMatchObject({ local: true });
    expect(read("/f/notes/comp.txt")).toMatchObject({ local: false });
    expect(
      classify({ ...at, name: "Bash", input: { command: "cat ~/.zshrc" }, output: "x" }),
    ).toMatchObject({ source: "command", local: true });
    expect(classify({ ...at, name: "mcp__gmail__read", input: {}, output: "mail" })).toMatchObject({
      local: true,
    });
    expect(
      classify({ ...at, name: "WebSearch", input: { query: "q" }, output: "r" }),
    ).toMatchObject({ local: false });
  });

  it("leaves out reading back a file the thread wrote itself", () => {
    expect(
      classify({
        ...at,
        made: new Set(["/Users/x/bench/src/gen.ts"]),
        name: "Read",
        input: { file_path: "/Users/x/bench/src/gen.ts" },
        output: "x",
      }),
    ).toBeNull();
  });

  it("reads a content list's text parts as the output", () => {
    expect(
      outputText([
        { type: "content", content: { type: "text", text: "a" } },
        { type: "text", text: "b" },
      ]),
    ).toBe("a\nb");
  });
});

describe("readsOnly", () => {
  it("keeps commands that only read, as inputs", () => {
    for (const c of [
      'cd "/Users/x/Startup Ideas"; ls; echo ---; cat Notes.md',
      "cd ~/anur-living-map && git log --oneline | head -15 && ls && head -40 package.json 2>/dev/null",
      "ls ~ ~/code 2>/dev/null | head -60; mdfind -name living-map 2>/dev/null | grep -v Library",
      'rg -n "terraform|k8s" src 2>&1 | head',
      "sed -n '1,40p' README.md",
    ])
      expect(readsOnly(c), c).toBe(true);
  });

  it("leaves out the agent's own work: writing, running, building", () => {
    for (const c of [
      "mkdir -p ~/workspace/bench/{fixture,src}",
      "cd ~/workspace/bench/fixture\ncat > terraform/network.tf <<'EOF'\nresource {}\nEOF",
      "cd ~/workspace/bench && node src/generate.ts --n 60 --out /tmp/out 2>&1 | tail",
      "cd ~/workspace/bench && node --test test/ 2>&1 | tail -25",
      "cd ~/workspace/bench && python3 - <<'EOF'\nprint(1)\nEOF",
      "echo hi > notes.txt",
      "sed -i '' 's/a/b/' x.md",
      "find . -name '*.tmp' -delete",
      "git commit -m wip",
      "curl -X POST https://example.com/api -d '{}'",
      "claude --help 2>&1 | grep -iE schema",
    ])
      expect(readsOnly(c), c).toBe(false);
  });
});
