/**
 * The context eval (task 3.13): Anur's threads against one long chat on the
 * same brainstorm, modelled on Laban et al., "LLMs Get Lost In Multi-Turn
 * Conversation" (https://arxiv.org/abs/2505.06120).
 *
 *   node evals/context/run.ts [runs]
 *
 * It runs the person's own Claude Code, so each run spends their tokens:
 * about four prompts each way, kept short. Each run writes its results to
 * evals/context/results/.
 *
 * - Anur: each section's thread is its own session, starting from its
 *   bundle, built by core exactly as a thread's first turn.
 * - Baseline: one chat that sees the whole doc, then every discussion in
 *   turn, as a person brainstorming in one long chat would.
 *
 * Both run in an empty folder, told to answer from what they were given,
 * so neither reads the doc from disk.
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { buildBundle, buildSectionTree } from "../../packages/core/src/index.ts";
import { findClaude, loginPath } from "../../packages/desktop/src/agent/find-claude.ts";
import {
  CHANNEL_THREAD,
  CONSTRAINTS,
  DOC,
  EMAIL_ASK,
  ESCALATION_ASK,
  FILE,
  leaks,
} from "./scenario.ts";

type Acp =
  typeof import("../../packages/desktop/node_modules/@agentclientprotocol/sdk/dist/v1/stable/acp.js");

const desktop = createRequire(new URL("../../packages/desktop/package.json", import.meta.url));
const acp = (await import(desktop.resolve("@agentclientprotocol/sdk"))) as Acp;
const adapter = path.join(
  path.dirname(desktop.resolve("@agentclientprotocol/claude-agent-acp/package.json")),
  "dist",
  "index.js",
);

const NO_TOOLS =
  "Answer only from what you've been given in this chat. Don't read files, search or use any tool.";

async function connect() {
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
    // No tools in the eval: any permission the agent asks for is declined.
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
  const cwd = await mkdtemp(path.join(tmpdir(), "anur-eval-"));
  return {
    async session() {
      const s = await conn.agent.request(acp.methods.agent.session.new, { cwd, mcpServers: [] });
      return {
        async ask(prompt: string): Promise<string> {
          const before = text.get(s.sessionId)?.length ?? 0;
          await conn.agent.request(acp.methods.agent.session.prompt, {
            sessionId: s.sessionId,
            prompt: [{ type: "text", text: prompt }],
          });
          return (text.get(s.sessionId) ?? "").slice(before).trim();
        },
      };
    },
    close() {
      child.kill();
    },
  };
}

const tree = buildSectionTree(DOC, { fileName: FILE });
const at = (name: string) => tree.sections.findIndex((s) => s.path.at(-1) === name);
const bundleFor = (name: string) =>
  buildBundle({ text: DOC, tree, index: at(name), docPath: FILE }).markdown;

type Run = { escalation: string; email: string };

/** Anur: one session per section's thread, each starting from its bundle. */
async function anur(agent: Awaited<ReturnType<typeof connect>>): Promise<Run> {
  const channel = await agent.session();
  for (const [i, turn] of CHANNEL_THREAD.entries())
    await channel.ask(
      i === 0 ? `${bundleFor("Notification channel")}\n\n---\n\n${NO_TOOLS}\n\n${turn}` : turn,
    );
  const escalation = await (
    await agent.session()
  ).ask(`${bundleFor("Escalation")}\n\n---\n\n${NO_TOOLS}\n\n${ESCALATION_ASK}`);
  const email = await (
    await agent.session()
  ).ask(`${bundleFor("Escalation email")}\n\n---\n\n${NO_TOOLS}\n\n${EMAIL_ASK}`);
  return { escalation, email };
}

/** The baseline: one long chat, the whole doc, then each discussion in turn. */
async function oneChat(agent: Awaited<ReturnType<typeof connect>>): Promise<Run> {
  const chat = await agent.session();
  await chat.ask(
    `We're brainstorming this doc, section by section. ${NO_TOOLS} Reply OK.\n\n${DOC}`,
  );
  await chat.ask(`Let's talk about "Notification channel". ${CHANNEL_THREAD[0] ?? ""}`);
  await chat.ask(CHANNEL_THREAD[1] ?? "");
  const escalation = await chat.ask(`Now "Escalation". ${ESCALATION_ASK}`);
  const email = await chat.ask(`Now "Escalation email". ${EMAIL_ASK}`);
  return { escalation, email };
}

const score = (r: Run) => ({
  leaked: leaks(r.escalation),
  kept: CONSTRAINTS.map((c) => c.kept(r.email)),
});

const runs = Math.max(1, Number(process.argv[2] ?? 3));
const agent = await connect();
const results: {
  mode: "anur" | "one-chat";
  run: number;
  drafts: Run;
  leaked: boolean;
  kept: boolean[];
}[] = [];
try {
  for (let i = 0; i < runs; i++) {
    for (const [mode, fn] of [
      ["anur", anur],
      ["one-chat", oneChat],
    ] as const) {
      const drafts = await fn(agent);
      results.push({ mode, run: i + 1, drafts, ...score(drafts) });
      process.stdout.write(`run ${String(i + 1)} ${mode}: done\n`);
    }
  }
} finally {
  agent.close();
}

const rate = (mode: string, f: (r: (typeof results)[number]) => boolean) => {
  const of = results.filter((r) => r.mode === mode);
  return `${String(of.filter(f).length)}/${String(of.length)}`;
};
const rows = [
  [
    "Rejected option leaks into a sibling's draft",
    (r: (typeof results)[number]) => r.leaked,
  ] as const,
  ...CONSTRAINTS.map(
    (c, i) => [`Kept: ${c.name}`, (r: (typeof results)[number]) => r.kept[i] === true] as const,
  ),
];
const table = [
  "| Check | Anur's threads | One long chat |",
  "|---|---|---|",
  ...rows.map(([name, f]) => `| ${name} | ${rate("anur", f)} | ${rate("one-chat", f)} |`),
].join("\n");
process.stdout.write(`\n${table}\n`);

const dir = path.join(import.meta.dirname, "results");
await mkdir(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
await writeFile(
  path.join(dir, `${stamp}.json`),
  `${JSON.stringify({ runs, table, results }, null, 2)}\n`,
);
process.stdout.write(`\nWrote evals/context/results/${stamp}.json\n`);
