/**
 * The brainstorm eval (group 30): each scenario in scenarios.ts, run as the
 * threads Anur would start, with Anur's real tools, checked by rules read
 * from the tool calls the agent made. No model grades it.
 *
 *   node evals/scenarios/run.ts [runs] [scenario,…]
 *
 * It runs the person's own Claude Code, so each run spends their tokens:
 * five short sessions per scenario. Any tool outside Anur's is declined and
 * logged, so nothing reaches a real service. Results go to
 * evals/scenarios/results/, not committed.
 *
 * Rules:
 * - options: the choice comes back through anur_offer_options;
 * - heading: asked on the title, that set names its decision;
 * - several: parts that all belong come back as one "several" set;
 * - work rule: the person's rule is recorded with concerns "work";
 * - worded: the decision is a statement of at most 7 words, in no one's
 *   voice; refused as the app refuses it, the agent tries again;
 * - scoped: a rule said "for this" is kept no wider than the doc;
 * - kept out: the rule never shows in the section text the agent writes;
 * - clean: after a pick, a new thread never names the options passed over;
 * - nothing sent: the agent never tried to send, post or publish.
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import {
  buildBundle,
  buildSectionTree,
  decisionWordingProblem,
} from "../../packages/core/src/index.ts";
import { findClaude, loginPath } from "../../packages/desktop/src/agent/find-claude.ts";
import {
  AnurSocket,
  type ToolAnswer,
} from "../../packages/desktop/src/main/threads/anur-socket.ts";
import { readSection } from "../../packages/desktop/src/main/threads/read-section.ts";
import { SCENARIOS, type Scenario } from "./scenarios.ts";
import { tempDir } from "../temp.ts";

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

type Call = { tool: string; args: Record<string, unknown>; refused?: string };

/** Anur's tools answered as the app would, each call kept for the rules. */
function handlerFor(doc: string, file: string, calls: Call[]) {
  return (tool: string, args: unknown): Promise<ToolAnswer> => {
    const a = (args ?? {}) as Record<string, unknown>;
    calls.push({ tool, args: a });
    if (tool === "anur_read_section")
      return Promise.resolve(
        typeof a.section === "string"
          ? readSection(doc, file, a.section, false)
          : { error: "Say which section, by its heading." },
      );
    if (tool === "anur_offer_options") {
      const n = Array.isArray(a.options) ? a.options.length : 0;
      return Promise.resolve({
        text:
          a.several === true
            ? `Shown to the person as ${String(n)} parts. They add any of them, each as its own subsection.`
            : typeof a.heading === "string"
              ? `Shown to the person as ${String(n)} options for "${a.heading}". They pick one, and its text goes under a subsection "${a.heading}".`
              : `Shown to the person as ${String(n)} options. They pick one, and its text replaces the section's.`,
      });
    }
    if (tool === "anur_note_decision") {
      // Worded as the app requires (2026-11-19): refused, the agent tries again.
      const problem = decisionWordingProblem(typeof a.decision === "string" ? a.decision : "");
      if (problem) {
        const last = calls.at(-1);
        if (last) last.refused = problem;
        return Promise.resolve({ error: problem });
      }
      return Promise.resolve({
        text: "Recorded as decided, shown to the person with Undo. It reaches every new thread on this section.",
      });
    }
    return Promise.resolve({ text: "Done." });
  };
}

async function connect(socket: AnurSocket) {
  const pathEnv = await loginPath();
  const claude = await findClaude(pathEnv);
  if (!claude) throw new Error("Claude Code isn't installed.");
  const child = spawn(process.execPath, [adapter], {
    env: { ...process.env, PATH: pathEnv, CLAUDE_CODE_EXECUTABLE: claude },
    stdio: ["pipe", "pipe", "ignore"],
  });
  const text = new Map<string, string>();
  /** Tools outside Anur's that the agent asked to run, declined, by session. */
  const declined = new Map<string, string[]>();
  const conn = acp
    .client({ name: "anur-scenario-eval" })
    .onNotification(acp.methods.client.session.update, ({ params }) => {
      const u = params.update;
      if (u.sessionUpdate === "agent_message_chunk" && u.content.type === "text")
        text.set(params.sessionId, (text.get(params.sessionId) ?? "") + u.content.text);
    })
    // Only Anur's own tools, and the lookup that loads them, run.
    .onRequest(acp.methods.client.session.requestPermission, ({ params }) => {
      const title = params.toolCall.title ?? "";
      const allowed = /mcp__anur__|anur_|ToolSearch/i.test(title);
      if (!allowed)
        declined.set(params.sessionId, [...(declined.get(params.sessionId) ?? []), title]);
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
  const cwd = await tempDir("anur-scenario-");
  return {
    /** A session with Anur's tools, answering from `doc`; the calls it makes land in `calls`. */
    async session(doc: string, file: string, calls: Call[]) {
      const token = socket.issue(handlerFor(doc, file, calls));
      const s = await conn.agent.request(acp.methods.agent.session.new, {
        cwd,
        mcpServers: [
          {
            name: "anur",
            command: process.execPath,
            args: [mcpServer],
            env: [
              { name: "ANUR_SOCKET", value: socket.path },
              { name: "ANUR_TOKEN", value: token },
            ],
          },
        ],
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
        declined: () => declined.get(s.sessionId) ?? [],
      };
    },
    close() {
      child.kill();
    },
  };
}

type Agent = Awaited<ReturnType<typeof connect>>;

/** The bundle a thread on `section` would start from, then the person's words. */
function opening(
  doc: string,
  file: string,
  section: string,
  words: string,
  findings: Parameters<typeof buildBundle>[0]["findings"] = [],
) {
  const tree = buildSectionTree(doc, { fileName: file });
  const index = Math.max(
    0,
    tree.sections.findIndex((s) => s.path.at(-1) === section),
  );
  return `${buildBundle({ text: doc, tree, index, docPath: file, findings }).markdown}\n\n---\n\n${words}`;
}

const offers = (calls: Call[]) => calls.filter((c) => c.tool === "anur_offer_options");
const titlesOf = (c: Call | undefined) =>
  Array.isArray(c?.args.options)
    ? (c.args.options as { title?: unknown; text?: unknown }[]).map((o) => ({
        title: typeof o.title === "string" ? o.title : "",
        text: typeof o.text === "string" ? o.text : "",
      }))
    : [];

type Checked = {
  scenario: string;
  run: number;
  options: boolean;
  heading: boolean | null;
  several: boolean;
  workRule: boolean;
  /** The first try at recording it read as a short statement. */
  wordedFirst: boolean | null;
  /** What was kept reads as one: at most 7 words, no one's voice. */
  worded: boolean | null;
  /** Kept no wider than the doc: the rule says "for this". */
  scoped: boolean | null;
  keptOut: boolean;
  clean: boolean | null;
  nothingSent: boolean;
  notes: Record<string, unknown>;
};

async function runScenario(agent: Agent, sc: Scenario, run: number): Promise<Checked> {
  const file = `${sc.title}.md`;
  const blank = `# ${sc.title}\n\n`;
  const declined: string[] = [];

  // A: the decision, asked on the title; then a rule about the work.
  const aCalls: Call[] = [];
  const a = await agent.session(blank, file, aCalls);
  await a.ask(opening(blank, file, sc.title, sc.decide));
  const decided = offers(aCalls).find((c) => c.args.several !== true);
  const ruleFrom = aCalls.length;
  await a.ask(sc.workRule);
  const tries = aCalls.slice(ruleFrom).filter((c) => c.tool === "anur_note_decision");
  const noted = tries.filter((c) => !c.refused).map((c) => c.args);
  declined.push(...a.declined());

  // B: parts that all belong.
  const bCalls: Call[] = [];
  const b = await agent.session(blank, file, bCalls);
  await b.ask(opening(blank, file, sc.title, sc.parts));
  declined.push(...b.declined());

  // C: the picked option in the doc, under its heading; a new thread on it.
  const picked = titlesOf(decided);
  const chosen = picked[Math.min(sc.pick, picked.length - 1)];
  let clean: boolean | null = null;
  let riskReply = "";
  const passedOver = picked.filter((o) => o !== chosen).map((o) => o.title);
  if (chosen) {
    const heading =
      typeof decided?.args.heading === "string" && decided.args.heading.trim()
        ? decided.args.heading.trim()
        : "Decision";
    const doc = `${blank}## ${heading}\n\n${chosen.text}\n`;
    const cCalls: Call[] = [];
    const c = await agent.session(doc, file, cCalls);
    riskReply = await c.ask(opening(doc, file, heading, sc.risk));
    const said = [riskReply, JSON.stringify(cCalls)].join("\n").toLowerCase();
    // A title of two or more words, said whole; one generic word is no leak.
    clean = passedOver.every(
      (t) => t.trim().split(/\s+/).length < 2 || !said.includes(t.toLowerCase()),
    );
    declined.push(...c.declined());
  }

  // D: a section written while a rule about the work holds.
  const dCalls: Call[] = [];
  const d = await agent.session(blank, file, dCalls);
  const written = await d.ask(
    opening(blank, file, sc.title, sc.write, [
      {
        claim: sc.rule,
        source: null,
        section: sc.title,
        by: "person",
        who: "Sam",
        concerns: "work",
      },
    ]),
  );
  declined.push(...d.declined());

  return {
    scenario: sc.name,
    run,
    options: decided !== undefined && picked.length >= 2,
    heading: sc.headed
      ? typeof decided?.args.heading === "string" && decided.args.heading.trim() !== ""
      : null,
    several: offers(bCalls).some((c) => c.args.several === true),
    workRule: noted.some((n) => n.concerns === "work"),
    wordedFirst: tries[0] ? !tries[0].refused : null,
    worded: noted.length
      ? noted.every(
          (n) =>
            typeof n.decision === "string" &&
            n.decision.trim().split(/\s+/).length <= 7 &&
            !decisionWordingProblem(n.decision),
        )
      : null,
    scoped: noted.length
      ? noted.every((n) => n.scope === undefined || n.scope === "section" || n.scope === "doc")
      : null,
    // The section text it wrote: the options' texts when it offered some, else its reply.
    keptOut: !sc.ruleWords.test(
      offers(dCalls).length
        ? offers(dCalls)
            .flatMap((c) => titlesOf(c).map((o) => o.text))
            .join("\n")
        : written,
    ),
    clean,
    nothingSent: !declined.some((t) => /send|post|publish/i.test(t)),
    notes: {
      decided: picked.map((o) => o.title),
      heading: decided?.args.heading ?? null,
      parts: offers(bCalls).map((c) => ({
        several: c.args.several ?? false,
        titles: titlesOf(c).map((o) => o.title),
      })),
      noted,
      refused: tries.flatMap((c) => (c.refused ? [c.refused] : [])),
      passedOver,
      riskReply,
      written,
      declined,
    },
  };
}

const runs = Math.max(1, Number(process.argv[2] ?? 1));
const only = process.argv[3]?.split(",");
const scenarios = SCENARIOS.filter((s) => !only || only.includes(s.name));

const socket = new AnurSocket(await tempDir("anur-scn-s-"));
await socket.start();
const agent = await connect(socket);
const results: Checked[] = [];
try {
  for (let i = 0; i < runs; i++)
    for (const sc of scenarios) {
      results.push(await runScenario(agent, sc, i + 1));
      process.stdout.write(`run ${String(i + 1)} ${sc.name}: done\n`);
    }
} finally {
  agent.close();
  socket.close();
}

const RULES: [string, (r: Checked) => boolean | null][] = [
  ["Choice comes as options", (r) => r.options],
  ["Options name their decision (when it isn't the title)", (r) => r.heading],
  ["Parts come as a several set", (r) => r.several],
  ["Work rule recorded as work", (r) => r.workRule],
  ["Decision worded right first time", (r) => r.wordedFirst],
  ["Decision kept as a statement of ≤7 words", (r) => r.worded],
  ["Decision scoped no wider than the doc", (r) => r.scoped],
  ["Work rule kept out of the text", (r) => r.keptOut],
  ["New thread never names options passed over", (r) => r.clean],
  ["Never tried to send", (r) => r.nothingSent],
];
const rate = (name: string, f: (r: Checked) => boolean | null) => {
  const of = results.filter((r) => r.scenario === name && f(r) !== null);
  return of.length ? `${String(of.filter((r) => f(r) === true).length)}/${String(of.length)}` : "–";
};
const names = scenarios.map((s) => s.name);
const table = [
  `| Rule | ${names.join(" | ")} |`,
  `|---|${names.map(() => "---").join("|")}|`,
  ...RULES.map(([rule, f]) => `| ${rule} | ${names.map((n) => rate(n, f)).join(" | ")} |`),
].join("\n");
process.stdout.write(`\n${table}\n`);

const dir = path.join(import.meta.dirname, "results");
await mkdir(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
await writeFile(
  path.join(dir, `${stamp}.json`),
  `${JSON.stringify({ runs, scenarios: names, table, results }, null, 2)}\n`,
);
process.stdout.write(`\nWrote evals/scenarios/results/${stamp}.json\n`);
