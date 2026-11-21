/**
 * The carry eval (18.7): does a decision reach the threads it should, and
 * only those, when there are 200 of them? Two parts.
 *
 *   node evals/carry/run.ts [runs] [--no-model]
 *
 * - Selection, no model: Anur's own reader and bundle, on a workspace with
 *   200 committed decisions and findings (fixture.ts). A thread on
 *   docs/plan.md › Pricing should get exactly the 100 that reach it, nearest
 *   first, with disputed pairs marked, and none of the other 100: other
 *   sections, docs, folders and repos, lapsed, dropped, replaced, on a
 *   section that's gone, and lines that aren't decisions.
 * - Following, with the person's own Claude Code: twelve questions, each a
 *   new thread with Anur's real prompt, each answered by one decision among
 *   the hundred. Scored by script: the right word, never a wrong one (the
 *   replaced one, a stale line in the doc, a lapsed one), both sides of a
 *   disagreement named, and the decision named as what it relied on.
 *
 * Results go to evals/carry/results/, not committed.
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { CARRY_CAP } from "../../packages/core/src/context/bundle.ts";
import { findClaude, loginPath } from "../../packages/desktop/src/agent/find-claude.ts";
import type { AgentHub } from "../../packages/desktop/src/main/threads/hub.ts";
import type { ToHost } from "../../packages/desktop/src/agent/protocol.ts";
import { CommittedDecisions } from "../../packages/desktop/src/main/committed-decisions.ts";
import { HomeVersions } from "../../packages/desktop/src/main/folder/home-versions.ts";
import { Threads } from "../../packages/desktop/src/main/threads/threads.ts";
import {
  CARRIES,
  DOC_REL,
  REACH,
  SECTION,
  docText,
  makeWorkspace,
  type Seeded,
} from "./fixture.ts";

type Acp =
  typeof import("../../packages/desktop/node_modules/@agentclientprotocol/sdk/dist/v1/stable/acp.js");

// ── Part 1: selection ────────────────────────────────────────────────────

const root = await mkdtemp(path.join(tmpdir(), "anur-carry-"));
const personal = await mkdtemp(path.join(tmpdir(), "anur-carry-me-"));
const { seeded, stale } = await makeWorkspace(root, personal);

const byKind = (k: Seeded["kind"]) => seeded.filter((s) => s.kind === k);
const replaced = byKind("replaced");
const replacing = byKind("replacing");
const disputed = byKind("disputed");
// Two of the section's own decisions, contradicted by a stale line in the doc.
const staleTopics = byKind("own").slice(0, 2);
const DOC = docText(staleTopics.map((s) => s.topic));
await writeFile(path.join(root, DOC_REL), DOC);

const store = new CommittedDecisions(
  root,
  "mac-a",
  () => Promise.resolve("priya"),
  () => undefined,
  () => undefined,
  personal,
  () => undefined,
);
const versions = new HomeVersions(root, "mac-a");
const sent: ToHost[] = [];
const hub = {
  status: () => ({ id: "claude-code", connected: true, reason: null, agent: null }),
  route: () => undefined,
  drop: () => undefined,
  send: (m: ToHost) => sent.push(m),
} as unknown as AgentHub;
const threads = new Threads({
  folder: root,
  device: "mac-a",
  appSupport: await mkdtemp(path.join(tmpdir(), "anur-carry-support-")),
  hub,
  hookScript: "/x/hook.js",
  node: "/x/node",
  locate: (rel, text) => versions.locate(rel, text),
  anurDirOf: (doc) => versions.anurDirOf(doc),
  anurDirs: () => versions.anurDirs(),
  relOf: (doc) => versions.relOf(doc),
  emit: () => undefined,
  previewsChanged: () => undefined,
  defaultAgent: () => "claude-code",
  committed: {
    keep: () => Promise.resolve(null),
    drop: () => Promise.resolve(),
    collected: () => store.all(["api", "web"]),
  },
});

/** Anur's real first prompt for a new thread on Pricing that asks `message`. */
async function promptFor(message: string): Promise<string> {
  const r = await threads.start(DOC_REL, DOC, SECTION, message);
  if (r.kind !== "started") throw new Error(r.reason);
  const p = sent.filter((m) => m.type === "prompt").at(-1);
  if (p?.type !== "prompt") throw new Error("nothing was asked");
  return p.text;
}

const probe = await promptFor("Which report goes where?");
const present = (s: Seeded) => new RegExp(`\\b${s.answer}\\b`).test(probe);
const reaches = seeded.filter((s) => CARRIES.has(s.kind));
const shouldNot = seeded.filter((s) => !CARRIES.has(s.kind));
// Listed: up to CARRY_CAP decisions and as many findings, nearest first, then oldest (18.3).
const nearest = (list: Seeded[]) =>
  [...list]
    .sort((a, b) => (REACH[a.kind] ?? 9) - (REACH[b.kind] ?? 9) || a.at.localeCompare(b.at))
    .slice(0, CARRY_CAP);
const listed = new Set([
  ...nearest(reaches.filter((s) => s.kind !== "finding")),
  ...nearest(reaches.filter((s) => s.kind === "finding")),
]);
const unlisted = reaches.filter((s) => !listed.has(s));
const missed = [...listed].filter((s) => !present(s));
const extra = unlisted.filter((s) => present(s) && !(s.kind === "disputed"));
const leaked = shouldNot.filter(
  (s) =>
    present(s) &&
    // A replaced decision's words live on in its replacement's "Instead of".
    !(s.kind === "replaced" && replacing.some((r) => r.topic === s.topic)),
);
const countLine = /And (\d+) more decided further from here/.exec(probe);
// Nearest first: each listed decision's place in the prompt, by reach.
const order = [...listed]
  .filter(present)
  .map((s) => ({ reach: REACH[s.kind] ?? 9, at: probe.indexOf(s.answer) }))
  .sort((a, b) => a.at - b.at);
const outOfOrder = order.filter((o, i) => i > 0 && o.reach < (order[i - 1]?.reach ?? 0)).length;
const disputesMarked = disputed.every((d) => {
  const at = probe.indexOf(d.answer);
  const line = probe.slice(probe.lastIndexOf("\n", at) + 1, probe.indexOf("\n", at));
  return /disagree|neither/i.test(line);
});
const staleLeak = new RegExp(`\\b${stale}\\b`).test(
  probe.slice(probe.indexOf("## Decided"), probe.length),
);
const tally = (list: Seeded[]) =>
  Object.fromEntries(
    [...new Set(list.map((s) => s.kind))].map((k) => [k, list.filter((s) => s.kind === k).length]),
  );

const selection = {
  seeded: seeded.length,
  reach: reaches.length,
  listedExpected: listed.size,
  listed: listed.size - missed.length,
  missed: missed.map((s) => `${s.kind} ${s.topic}`),
  listedBeyondNearest: extra.map((s) => `${s.kind} ${s.topic}`),
  leaked: leaked.map((s) => `${s.kind} ${s.topic}`),
  /** Reach this thread but past the cap: only counted, unreadable by the agent. */
  unlisted: {
    count: unlisted.length,
    byKind: tally(unlisted),
    countLineSays: countLine?.[1] ?? null,
  },
  outOfOrder,
  disputesMarked,
  staleInDecisions: staleLeak,
  promptChars: probe.length,
};
console.log("selection:", JSON.stringify(selection, null, 2));

// ── Part 2: following ────────────────────────────────────────────────────

type Task = {
  name: string;
  topic: string;
  right: string[];
  wrong: string[];
  /** Both sides must be named, and no one picked. */
  both?: boolean;
  /** No decision answers it: it should say so, not guess. */
  none?: boolean;
};

const pairOf = (list: Seeded[], i: number) => [list[i * 2], list[i * 2 + 1]] as const;
const one = (k: Seeded["kind"], i = 0): Seeded => {
  const s = byKind(k)[i];
  if (!s) throw new Error(`no ${k}`);
  return s;
};
const TASKS: Task[] = [
  ...[0, 1, 2].map((i): Task => {
    const old = replaced[i];
    const now = replacing[i];
    if (!old || !now) throw new Error("no replaced");
    return { name: "replaced", topic: now.topic, right: [now.answer], wrong: [old.answer] };
  }),
  ...[0, 1].map((i): Task => {
    const [a, b] = pairOf(disputed, i);
    if (!a || !b) throw new Error("no dispute");
    return { name: "disputed", topic: a.topic, right: [a.answer, b.answer], wrong: [], both: true };
  }),
  ...staleTopics.map((s): Task => ({
    name: "stale doc",
    topic: s.topic,
    right: [s.answer],
    wrong: [stale],
  })),
  {
    name: "everywhere",
    topic: one("everywhere").topic,
    right: [one("everywhere").answer],
    wrong: [],
  },
  { name: "repo", topic: one("repo", 3).topic, right: [one("repo", 3).answer], wrong: [] },
  { name: "above", topic: one("above", 7).topic, right: [one("above", 7).answer], wrong: [] },
  { name: "folder", topic: one("folder", 2).topic, right: [one("folder", 2).answer], wrong: [] },
  {
    name: "lapsed",
    topic: one("lapsed", 4).topic,
    right: [],
    wrong: [one("lapsed", 4).answer],
    none: true,
  },
];

const ASK = (topic: string) =>
  `Where does the ${topic} report go? Answer in one or two sentences, from what you've been given only. Don't read files, search or run commands.`;

async function connect() {
  // From the repo root, where the eval is run from, bundled or not.
  const desktop = createRequire(path.join(process.cwd(), "packages/desktop/package.json"));
  const acp = (await import(desktop.resolve("@agentclientprotocol/sdk"))) as Acp;
  const adapter = path.join(
    path.dirname(desktop.resolve("@agentclientprotocol/claude-agent-acp/package.json")),
    "dist",
    "index.js",
  );
  const pathEnv = await loginPath();
  const claude = await findClaude(pathEnv);
  if (!claude) throw new Error("Claude Code isn't installed.");
  const child = spawn(process.execPath, [adapter], {
    env: { ...process.env, PATH: pathEnv, CLAUDE_CODE_EXECUTABLE: claude },
    stdio: ["pipe", "pipe", "ignore"],
  });
  const text = new Map<string, string>();
  const conn = acp
    .client({ name: "anur-eval" })
    .onNotification(acp.methods.client.session.update, ({ params }) => {
      const u = params.update;
      if (u.sessionUpdate === "agent_message_chunk" && u.content.type === "text")
        text.set(params.sessionId, (text.get(params.sessionId) ?? "") + u.content.text);
    })
    // Nothing runs: every tool is declined.
    .onRequest(acp.methods.client.session.requestPermission, () => ({
      outcome: { outcome: "cancelled" as const },
    }))
    .connect(
      acp.ndJsonStream(
        Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>,
      ),
    );
  await conn.agent.request(acp.methods.agent.initialize, {
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
  });
  const cwd = await mkdtemp(path.join(tmpdir(), "anur-carry-agent-"));
  return {
    async ask(prompt: string): Promise<string> {
      const s = await conn.agent.request(acp.methods.agent.session.new, { cwd, mcpServers: [] });
      await conn.agent.request(acp.methods.agent.session.prompt, {
        sessionId: s.sessionId,
        prompt: [{ type: "text", text: prompt }],
      });
      return (text.get(s.sessionId) ?? "").trim();
    },
    close: () => child.kill(),
  };
}

function score(t: Task, reply: string) {
  const has = (w: string) => new RegExp(`\\b${w}\\b`, "i").test(reply);
  const right = t.none ? true : t.both ? t.right.every(has) : t.right.some(has);
  // Naming the old answer to say it was replaced, or the doc's to say it's stale, is fine;
  // giving it as the answer, without the right one, is not.
  const wrong = t.wrong.some(has) && !(t.right.length > 0 && t.right.some(has));
  const relied = t.none || /decid|decision|agreed/i.test(reply);
  const said = t.none
    ? /no decision|not (been )?decided|don't know|isn't|not given|no record|nothing/i.test(reply)
    : true;
  return { right, wrong, relied, said, pass: right && !wrong && relied && said };
}

const runs = Math.max(1, Number(process.argv[2] ?? 1));
const withModel = !process.argv.includes("--no-model");
const following: {
  run: number;
  task: string;
  topic: string;
  /** Whether the answer was in the prompt at all, or past the cap. */
  inPrompt: boolean;
  reply: string;
  score: ReturnType<typeof score>;
}[] = [];
if (withModel) {
  const prompts = new Map<Task, string>();
  for (const t of TASKS) prompts.set(t, await promptFor(ASK(t.topic)));
  const agent = await connect();
  try {
    for (let run = 1; run <= runs; run++)
      for (const t of TASKS) {
        const prompt = prompts.get(t) ?? "";
        const inPrompt = t.right.every((w) => new RegExp(`\\b${w}\\b`).test(prompt));
        const reply = await agent.ask(prompt);
        const s = score(t, reply);
        following.push({ run, task: t.name, topic: t.topic, inPrompt, reply, score: s });
        console.log(
          `${s.pass ? "✓" : "✗"} ${t.name} ${t.topic}${inPrompt ? "" : " (not listed)"}: ${reply.replace(/\s+/g, " ").slice(0, 160)}`,
        );
      }
  } finally {
    agent.close();
  }
}
await threads.close();

const passed = following.filter((f) => f.score.pass).length;
const result = {
  at: new Date().toISOString(),
  selection,
  following: { tasks: TASKS.length, runs, passed, of: following.length, details: following },
};
const out = path.join(process.cwd(), "evals", "carry", "results");
await mkdir(out, { recursive: true });
const file = path.join(out, `${result.at.replace(/[:.]/g, "-")}.json`);
await writeFile(file, JSON.stringify(result, null, 2));
console.log(`following: ${String(passed)}/${String(following.length)}  →  ${file}`);
