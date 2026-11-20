import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { THREAD_SESSION_ENV } from "@anur/system";
import { atLeast, claudeCode, kiro, kiroToolTitle } from "./adapters.ts";

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

describe("the Kiro adapter", () => {
  const dir = path.join(tmpdir(), `anur-kiro-${String(process.pid)}`);
  const make = (version: string | null, installed = true) =>
    kiro({
      dir,
      locate: () =>
        Promise.resolve({ kiro: version ? "/x/kiro-cli" : null, version, path: "/usr/bin" }),
      hookInstalled: () => Promise.resolve(installed),
    });

  it("needs Kiro CLI 3.0 or later, and Anur's hook in it", async () => {
    expect(await make(null).launch()).toMatchObject({
      fail: expect.stringMatching(/isn't installed/) as unknown,
    });
    expect(await make("2.34.0").launch()).toMatchObject({
      fail: expect.stringMatching(/3\.0\.0 or later/) as unknown,
    });
    expect(await make("3.5.0", false).launch()).toMatchObject({
      fail: expect.stringMatching(/hook isn't in Kiro/) as unknown,
    });
    expect(atLeast("3.0.0", "3.0.0")).toBe(true);
    expect(atLeast("2.99.9", "3.0.0")).toBe(false);
    expect(atLeast("10.0.0", "3.0.0")).toBe(true);
  });

  it("starts V3 on the person's sign-in, marked so only its sessions meet Anur's hook", async () => {
    const launch = await make("3.5.0").launch();
    if ("fail" in launch) throw new Error(launch.fail);
    expect(launch.args).toEqual(["acp", "--agent-engine", "v3", "--auth-method", "cli"]);
    expect(launch.env.ANUR_KIRO).toBe(dir);
    expect(make("3.5.0").clientMeta).toEqual({ kiro: { hooks: { enabled: true, v2: true } } });
  });
});

describe("Kiro's step titles", () => {
  it("read as Claude Code's, so steps say what they did", () => {
    expect(kiroToolTitle("Read File", { path: "notes.md" })).toBe("Read notes.md");
    expect(kiroToolTitle("Replace in File", { path: "a.ts" })).toBe("Edit a.ts");
    expect(kiroToolTitle("Run Command", { command: "rg retry" })).toBe("rg retry");
    expect(kiroToolTitle("Tool Load", { id: "tool::anur::x" })).toBe("ToolSearch");
    expect(kiroToolTitle("@anur/anur_name_thread", {})).toBe("mcp__anur__anur_name_thread");
    expect(kiroToolTitle("Something New", {})).toBe("Something New");
  });
});
