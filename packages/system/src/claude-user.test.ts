import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CommittedEntry } from "@anur/core";
import { writeUserClaudeMd } from "./claude-user.ts";

const decision = {
  id: "d-1",
  at: "2026-11-18T10:00:00.000Z",
  dev: "m",
  seq: 0,
  kind: "decision",
  scope: "everywhere",
  ref: null,
  decision: "Answer in British English.",
  quote: "always British English",
  instead: null,
  until: null,
  who: "Sam",
  person: "sam",
} as CommittedEntry;

describe("decisions kept for everywhere, in Claude Code's user CLAUDE.md (18.3)", () => {
  it("adds the block after the person's own text, takes it out when none are left, and writes nothing without Claude Code", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "anur-claude-"));
    writeFileSync(path.join(dir, "CLAUDE.md"), "# Me\n\nPrefer short answers.\n");
    expect(writeUserClaudeMd([decision], dir)).toBe(true);
    const text = readFileSync(path.join(dir, "CLAUDE.md"), "utf8");
    expect(text.startsWith("# Me\n\nPrefer short answers.\n")).toBe(true);
    expect(text).toContain("## Decisions that apply everywhere");
    expect(text).toContain("- Answer in British English. (Sam)");
    expect(writeUserClaudeMd([], dir)).toBe(true);
    expect(readFileSync(path.join(dir, "CLAUDE.md"), "utf8")).toBe(
      "# Me\n\nPrefer short answers.\n",
    );
    expect(writeUserClaudeMd([decision], path.join(dir, "no-claude-here"))).toBe(false);
  });
});
