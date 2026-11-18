import { describe, expect, it } from "vitest";
import { classify, outputText } from "./inputs.ts";

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

  it("reads a content list's text parts as the output", () => {
    expect(
      outputText([
        { type: "content", content: { type: "text", text: "a" } },
        { type: "text", text: "b" },
      ]),
    ).toBe("a\nb");
  });
});
