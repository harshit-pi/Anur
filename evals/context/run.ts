/**
 * The context eval (task 3.13): Anur's threads against one long chat on the
 * same brainstorm, modelled on Laban et al., "LLMs Get Lost In Multi-Turn
 * Conversation" (https://arxiv.org/abs/2505.06120).
 *
 *   node evals/context/run.ts [runs] [modes]
 *
 * modes, comma-separated, from: one-chat, outline, full, fetch (default all).
 * It runs the person's own Claude Code, so each run spends their tokens:
 * about four short prompts per mode. Each run writes its results to
 * evals/context/results/, not committed.
 *
 * - one-chat: one chat that sees the whole doc, then every discussion in
 *   turn, as a person brainstorming in one long chat would.
 * - outline: Anur's threads, each its own session from its bundle, the rest
 *   of the doc as an outline (the default rules).
 * - full: the same, with the rest of the doc in full ("doc-full").
 * - fetch: the outline, told to read any section that could set a rule
 *   ("fetch-hint"), with Anur's real anur_read_section tool to read it.
 *
 * All run in an empty folder, so no agent reads the doc from disk.
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { buildBundle, buildSectionTree, type BundleRule } from "../../packages/core/src/index.ts";
import { findClaude, loginPath } from "../../packages/desktop/src/agent/find-claude.ts";
import { AnurSocket } from "../../packages/desktop/src/main/threads/anur-socket.ts";
import { readSection } from "../../packages/desktop/src/main/threads/read-section.ts";
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
const mcpServer = path.join(import.meta.dirname, "../../packages/desktop/src/agent/mcp-server.ts");

const ONLY_GIVEN =
  "Answer only from what you've been given in this chat. Don't read files, search or run commands.";
const ONLY_GIVEN_OR_ANUR =
  "Answer from what you've been given in this chat, and from Anur's anur_read_section tool. Don't read files, search or run commands.";

type Mcp = { socket: string; token: string } | null;

async function connect() {
  const pathEnv = await loginPath();
  const claude = await findClaude(pathEnv);
  if (!claude) throw new Error("Claude Code isn't installed.");
  const child = spawn(process.execPath, [adapter], {
    env: { ...process.env, PATH: pathEnv, CLAUDE_CODE_EXECUTABLE: claude },
    stdio: ["pipe", "pipe", "ignore"],
  });
  const text = new Map<string, string>();
  const reads = new Map<string, number>();
  const conn = acp
    .client({ name: "anur-eval" })
    .onNotification(acp.methods.client.session.update, ({ params }) => {
      const u = params.update;
      if (u.sessionUpdate === "agent_message_chunk" && u.content.type === "text")
        text.set(params.sessionId, (text.get(params.sessionId) ?? "") + u.content.text);
      if (u.sessionUpdate === "tool_call" && /anur_read_section/.test(u.title))
        reads.set(params.sessionId, (reads.get(params.sessionId) ?? 0) + 1);
    })
    // Only Anur's own tool, and the lookup that loads it, may run; anything else is declined.
    .onRequest(acp.methods.client.session.requestPermission, ({ params }) => {
      const allowed = /anur_read_section|ToolSearch/i.test(params.toolCall.title ?? "");
      const allow = params.options.find((o) => o.kind === "allow_once");
      return allowed && allow
        ? { outcome: { outcome: "selected" as const, optionId: allow.optionId } }
        : { outcome: { outcome: "cancelled" as const } };
    })
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
    async session(mcp: Mcp = null) {
      const s = await conn.agent.request(acp.methods.agent.session.new, {
        cwd,
        mcpServers: mcp
          ? [
              {
                name: "anur",
                command: process.execPath,
                args: [mcpServer],
                env: [
                  { name: "ANUR_SOCKET", value: mcp.socket },
                  { name: "ANUR_TOKEN", value: mcp.token },
                ],
              },
            ]
          : [],
      });
      return {
        async ask(prompt: string): Promise<string> {
          const before = text.get(s.sessionId)?.length ?? 0;
          await conn.agent.request(acp.methods.agent.session.prompt, {
            sessionId: s.sessionId,
            prompt: [{ type: "text", text: prompt }],
          });
          return (text.get(s.sessionId) ?? "").slice(before).trim();
        },
        reads: () => reads.get(s.sessionId) ?? 0,
      };
    },
    close() {
      child.kill();
    },
  };
}

const tree = buildSectionTree(DOC, { fileName: FILE });
const at = (name: string) => tree.sections.findIndex((s) => s.path.at(-1) === name);

type Agent = Awaited<ReturnType<typeof connect>>;
type Run = { escalation: string; email: string; reads: number };

const RULES: Record<"outline" | "full" | "fetch", readonly BundleRule[]> = {
  outline: ["ancestors-own-text", "section-subtree", "doc-outline"],
  full: ["ancestors-own-text", "section-subtree", "doc-full"],
  fetch: ["ancestors-own-text", "section-subtree", "doc-outline", "fetch-hint"],
};

/** Anur: one session per section's thread, each starting from its bundle. */
async function anur(agent: Agent, mode: "outline" | "full" | "fetch", mcp: Mcp): Promise<Run> {
  const tools = mode === "fetch" ? mcp : null;
  const rule = mode === "fetch" ? ONLY_GIVEN_OR_ANUR : ONLY_GIVEN;
  const bundle = (name: string) =>
    buildBundle({ text: DOC, tree, index: at(name), docPath: FILE, rules: RULES[mode] }).markdown;
  const channel = await agent.session(tools);
  for (const [i, turn] of CHANNEL_THREAD.entries())
    await channel.ask(
      i === 0 ? `${bundle("Notification channel")}\n\n---\n\n${rule}\n\n${turn}` : turn,
    );
  const esc = await agent.session(tools);
  const escalation = await esc.ask(
    `${bundle("Escalation")}\n\n---\n\n${rule}\n\n${ESCALATION_ASK}`,
  );
  const em = await agent.session(tools);
  const email = await em.ask(`${bundle("Escalation email")}\n\n---\n\n${rule}\n\n${EMAIL_ASK}`);
  return { escalation, email, reads: esc.reads() + em.reads() };
}

/** The baseline: one long chat, the whole doc, then each discussion in turn. */
async function oneChat(agent: Agent): Promise<Run> {
  const chat = await agent.session();
  await chat.ask(
    `We're brainstorming this doc, section by section. ${ONLY_GIVEN} Reply OK.\n\n${DOC}`,
  );
  await chat.ask(`Let's talk about "Notification channel". ${CHANNEL_THREAD[0] ?? ""}`);
  await chat.ask(CHANNEL_THREAD[1] ?? "");
  const escalation = await chat.ask(`Now "Escalation". ${ESCALATION_ASK}`);
  const email = await chat.ask(`Now "Escalation email". ${EMAIL_ASK}`);
  return { escalation, email, reads: 0 };
}

const runs = Math.max(1, Number(process.argv[2] ?? 3));
const MODES = ["one-chat", "outline", "full", "fetch"] as const;
type Mode = (typeof MODES)[number];
const modes = (process.argv[3]?.split(",") ?? [...MODES]).filter((m): m is Mode =>
  (MODES as readonly string[]).includes(m),
);

// Anur's tool socket, answering from the scenario's doc as the thread's own doc.
const socket = new AnurSocket(await mkdtemp(path.join(tmpdir(), "anur-eval-s-")));
await socket.start();
const token = socket.issue((_tool, args) => {
  const a = (args ?? {}) as { section?: unknown };
  return Promise.resolve(
    typeof a.section === "string"
      ? readSection(DOC, FILE, a.section, false)
      : { error: "Say which section, by its heading." },
  );
});
const mcp = { socket: socket.path, token };

const agent = await connect();
const results: { mode: Mode; run: number; drafts: Run; leaked: boolean; kept: boolean[] }[] = [];
try {
  for (let i = 0; i < runs; i++) {
    for (const mode of modes) {
      const drafts = mode === "one-chat" ? await oneChat(agent) : await anur(agent, mode, mcp);
      results.push({
        mode,
        run: i + 1,
        drafts,
        leaked: leaks(drafts.escalation),
        kept: CONSTRAINTS.map((c) => c.kept(drafts.email)),
      });
      process.stdout.write(`run ${String(i + 1)} ${mode}: done\n`);
    }
  }
} finally {
  agent.close();
  socket.close();
}

type Result = (typeof results)[number];
const rate = (mode: Mode, f: (r: Result) => boolean) => {
  const of = results.filter((r) => r.mode === mode);
  return `${String(of.filter(f).length)}/${String(of.length)}`;
};
const rows: [string, (r: Result) => boolean][] = [
  ["Rejected option leaks into a sibling's draft", (r) => r.leaked],
  ...CONSTRAINTS.map((c, i): [string, (r: Result) => boolean] => [
    `Kept: ${c.name}`,
    (r) => r.kept[i] === true,
  ]),
  ["Read a section with anur_read_section", (r) => r.drafts.reads > 0],
];
const table = [
  `| Check | ${modes.join(" | ")} |`,
  `|---|${modes.map(() => "---").join("|")}|`,
  ...rows.map(([name, f]) => `| ${name} | ${modes.map((m) => rate(m, f)).join(" | ")} |`),
].join("\n");
process.stdout.write(`\n${table}\n`);

const dir = path.join(import.meta.dirname, "results");
await mkdir(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
await writeFile(
  path.join(dir, `${stamp}.json`),
  `${JSON.stringify({ runs, modes, table, results }, null, 2)}\n`,
);
process.stdout.write(`\nWrote evals/context/results/${stamp}.json\n`);
