import { describe, expect, it } from "vitest";
import { THREAD_SESSION_ENV } from "@anur/system";
import { claudeCode } from "./adapters.ts";

describe("the Claude Code adapter", () => {
  it("marks a thread's session in its environment, so the person's task hooks leave it out", async () => {
    const adapter = claudeCode({
      node: "/x/node",
      adapter: "/x/adapter.js",
      adapterVersion: "0.0.0",
      nodeEnv: { ELECTRON_RUN_AS_NODE: "1" },
      locate: () => Promise.resolve({ claude: "/x/claude", version: "2.1.0", path: "/usr/bin" }),
    });
    const launch = await adapter.launch();
    if ("fail" in launch) throw new Error(launch.fail);
    expect(launch.env[THREAD_SESSION_ENV]).toBe("1");
    expect(launch.env.CLAUDE_CODE_EXECUTABLE).toBe("/x/claude");
  });
});
