// Every tool Anur gives an agent has a name a person reads, done and while
// running, so a thread never shows an id like mcp__anur__anur_propose_action.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TOOL_NAMES } from "./renderer/src/regions/step-label.ts";

describe("Anur's tools in a thread", () => {
  const server = readFileSync(new URL("./agent/mcp-server.ts", import.meta.url), "utf8");
  const tools = [...new Set([...server.matchAll(/name: "(anur_\w+)"/g)].map((m) => m[1]))];

  it("finds the tools the server gives", () => {
    expect(tools.length).toBeGreaterThan(10);
  });

  it("names each one, done and running", () => {
    expect(tools.filter((t) => !t || !TOOL_NAMES[t])).toEqual([]);
  });
});
