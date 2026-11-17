import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyPart } from "@anur/core";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentStatus } from "../../shared/ipc-contract.ts";
import { claudeCode, type AgentAdapter } from "../../agent/adapters.ts";
import { AgentHost } from "../../agent/host.ts";
import type { ToHost, ToMain } from "../../agent/protocol.ts";
import { SectionVersions } from "../folder/versions.ts";
import type { AgentHub } from "./hub.ts";
import { Threads } from "./threads.ts";

/**
 * "The app works end to end" (group 3), without the window: the main loop
 * from a doc to an applied preview, through the real agent host, the real
 * hook and its thread check, a working copy, the merge and the preview.
 * The agent is a fake that speaks ACP and runs Anur's hook as Claude Code
 * does; the window's part is checked in the running app.
 */

const DOC = `# Plan

Ship in March.

## Risks

The host is untested.

## Budget

Two people.
`;

const agentDir = path.join(import.meta.dirname, "..", "..", "agent");
const hook = path.join(agentDir, "hook.ts");

let threads: Threads | null = null;
afterEach(async () => {
  await threads?.close();
  threads = null;
});

async function loop(edit: { from: string; to: string; target?: (folder: string) => string }) {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), "anur-e2e-")));
  const support = await realpath(await mkdtemp(path.join(tmpdir(), "anur-e2e-support-")));
  await writeFile(path.join(folder, "plan.md"), DOC);
  await mkdir(path.join(folder, ".anur", "docs", "other"), { recursive: true });
  await writeFile(path.join(folder, ".anur", "docs", "other", "dev.jsonl"), "another thread\n");
  const real = claudeCode({
    node: process.execPath,
    nodeEnv: {},
    adapter: "",
    adapterVersion: "",
    locate: () => Promise.resolve({ claude: null, version: null, path: "" }),
  });
  const fake: AgentAdapter = {
    ...real,
    adapterVersion: "test",
    // The fake agent in place of Claude Code; Anur's guard reaches it the way it reaches Claude Code.
    launch: () =>
      Promise.resolve({
        command: process.execPath,
        args: [path.join(agentDir, "testing", "fake-agent.ts")],
        env: {
          FAKE_EDIT_FROM: edit.from,
          FAKE_EDIT_TO: edit.to,
          ...(edit.target ? { FAKE_TARGET: edit.target(folder) } : {}),
        },
        version: "test",
      }),
  };
  const statuses = new Map<string, AgentStatus>();
  const routes = new Map<string, (m: ToMain) => void>();
  const host = new AgentHost(
    (m) => {
      if (m.type === "status")
        statuses.set(m.id, { id: m.id, connected: m.connected, reason: m.reason, agent: m.agent });
      else if ("thread" in m) routes.get(m.thread)?.(m);
    },
    { node: process.execPath, nodeEnv: {}, hook, adapters: { "claude-code": fake } },
  );
  const hub = {
    status: (id: "claude-code") =>
      statuses.get(id) ?? { id, connected: null, reason: null, agent: null },
    route: (t: string, fn: (m: ToMain) => void) => routes.set(t, fn),
    drop: () => undefined,
    send: (m: ToHost) => {
      host.handle(m);
    },
  } as unknown as AgentHub;
  const versions = new SectionVersions(folder, "dev1");
  threads = new Threads({
    folder,
    device: "dev1",
    appSupport: support,
    hub,
    hookScript: hook,
    node: process.execPath,
    locate: (rel, text) => versions.locate(rel, text),
    emit: () => undefined,
    previewsChanged: () => undefined,
    defaultAgent: () => "claude-code",
  });
  return { folder, threads, statuses };
}

async function settled(t: Threads, text: string) {
  for (let i = 0; i < 200; i++) {
    const [listed] = await t.list("plan.md", text);
    if (listed && !listed.busy) return listed;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("the turn never ended");
}

describe("The app works end to end", () => {
  it("opens a doc, starts a thread, previews the agent's edit, and applies only that section", async () => {
    const {
      folder,
      threads: t,
      statuses,
    } = await loop({
      from: "The host is untested.",
      to: "The host has no tests yet.",
    });
    const r = await t.start(
      "plan.md",
      DOC,
      { index: 1, path: ["Plan", "Risks"] },
      "Tighten the risk.",
    );
    if (r.kind !== "started") throw new Error(r.reason);
    const done = await settled(t, DOC);

    // The thread check passed: the agent connected, and its edit was a call the hook saw.
    expect(statuses.get("claude-code")?.connected).toBe(true);
    expect(done.items.filter((i) => i.kind === "error")).toEqual([]);
    expect(done.items.at(-1)).toMatchObject({ kind: "message", role: "agent", text: "Done." });

    // The doc is untouched until a person applies.
    expect(await readFile(path.join(folder, "plan.md"), "utf8")).toBe(DOC);
    const [preview] = await t.listPreviews("plan.md", DOC);
    const part = preview?.parts[0];
    expect(preview?.parts.map((p) => p.path.at(-1))).toEqual(["Risks"]);
    if (!part) throw new Error("no preview");

    // Apply: only that section's bytes change.
    const from = DOC.indexOf("## Risks");
    const to = DOC.indexOf("## Budget");
    const made = applyPart(DOC.slice(from, to), part);
    if (made.kind !== "ok") throw new Error("conflict");
    const applied = DOC.slice(0, from) + made.text + DOC.slice(to);
    expect(applied).toBe(DOC.replace("The host is untested.", "The host has no tests yet."));
  });

  it("keeps the agent out of .anur/, where other threads live", async () => {
    const { folder, threads: t } = await loop({
      from: "another thread",
      to: "overwritten",
      target: (f) => path.join(f, ".anur", "docs", "other", "dev.jsonl"),
    });
    const r = await t.start("plan.md", DOC, { index: 1, path: ["Plan", "Risks"] }, "Edit it.");
    if (r.kind !== "started") throw new Error(r.reason);
    const done = await settled(t, DOC);
    expect(done.items.at(-1)).toMatchObject({ kind: "message", role: "agent" });
    const said = done.items.at(-1);
    expect(said?.kind === "message" && said.text).toMatch(
      /^Refused: Anur: \.anur\/ holds every other thread/,
    );
    expect(await readFile(path.join(folder, ".anur", "docs", "other", "dev.jsonl"), "utf8")).toBe(
      "another thread\n",
    );
  });

  it("turns an edit of the doc itself into a refusal that names the working copy", async () => {
    const { folder, threads: t } = await loop({
      from: "Two people.",
      to: "Ten people.",
      target: (f) => path.join(f, "plan.md"),
    });
    const r = await t.start("plan.md", DOC, { index: 2, path: ["Plan", "Budget"] }, "Edit it.");
    if (r.kind !== "started") throw new Error(r.reason);
    const done = await settled(t, DOC);
    const said = done.items.at(-1);
    expect(said?.kind === "message" && said.text).toMatch(/Your working copy of plan\.md is at /);
    expect(await readFile(path.join(folder, "plan.md"), "utf8")).toBe(DOC);
  });
});
