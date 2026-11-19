/**
 * The carry eval's folder (18.7): a workspace with two repos and 200
 * committed decisions and findings, most of them wrong for the thread under
 * test: other sections, other docs, other repos, lapsed, dropped, replaced,
 * on sections that are gone, and lines that aren't decisions at all.
 *
 * Each decision is about one topic ("the K-017 report") and names one
 * answer, a made-up word, so a reply can be checked by script.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/** Why a decision should, or shouldn't, reach a thread on docs/plan.md › Pricing. */
export type Kind =
  | "own"
  | "above"
  | "doc"
  | "repo"
  | "folder"
  | "everywhere"
  | "finding"
  | "replacing"
  | "disputed"
  | "sibling"
  | "other-doc"
  | "other-folder"
  | "other-repo"
  | "other-repo-doc"
  | "third-repo"
  | "lapsed"
  | "dropped"
  | "replaced"
  | "gone";

export const CARRIES: ReadonlySet<Kind> = new Set([
  "own",
  "above",
  "doc",
  "repo",
  "folder",
  "everywhere",
  "finding",
  "replacing",
  "disputed",
]);

/** How near each carried kind is (18.3): what "nearest first" sorts by. */
export const REACH: Partial<Record<Kind, number>> = {
  own: 0,
  finding: 0,
  replacing: 0,
  disputed: 0,
  above: 1,
  doc: 2,
  repo: 3,
  folder: 3,
  everywhere: 4,
};

const COUNTS: [Kind, number][] = [
  ["own", 20],
  ["above", 15],
  ["doc", 15],
  ["repo", 10],
  ["folder", 8],
  ["everywhere", 6],
  ["finding", 10],
  ["disputed", 8],
  ["sibling", 15],
  ["other-doc", 10],
  ["other-folder", 6],
  ["other-repo", 15],
  ["other-repo-doc", 10],
  ["third-repo", 5],
  ["lapsed", 15],
  ["dropped", 10],
  ["replaced", 8],
  ["gone", 6],
];

export type Seeded = {
  id: string;
  kind: Kind;
  /** The topic, "K-017", unique to this decision unless it shares one on purpose. */
  topic: string;
  answer: string;
  /** When it was kept: within a reach, older ones come first. */
  at: string;
};

export const DOC_REL = "docs/plan.md";
export const SECTION = { index: 1, path: ["Plan", "Pricing"] };

/** A pronounceable made-up word, the same for the same n. */
export function word(n: number): string {
  const c = "BDFGKLMNPRSTVZ";
  const v = "AEIOU";
  let x = (n * 2654435761 + 97) >>> 0;
  let out = "";
  for (let i = 0; i < 3; i++) {
    out += c.charAt(x % c.length) + v.charAt((x >>> 4) % v.length);
    x = (x * 1103515245 + 12345) >>> 0;
  }
  return out;
}

const STALE = "ZOLUMA";

export function docText(staleTopics: readonly string[]): string {
  return [
    "# Plan",
    "",
    "The referral launch plan.",
    "",
    "## Pricing",
    "",
    "Our price is £5 a month.",
    ...staleTopics.map((t) => `The ${t} report goes to ${STALE}.`),
    "",
    "## Launch",
    "",
    "Soft launch first.",
    "",
    "## Risks",
    "",
    "Fraud on referral rewards.",
    "",
  ].join("\n");
}

type Line = Record<string, unknown>;

/**
 * Writes the workspace into `root`, and the person's own decisions kept
 * for everywhere into `personal`; returns every seeded decision.
 */
export async function makeWorkspace(root: string, personal: string) {
  for (const repo of ["api", "web"]) {
    await mkdir(path.join(root, repo, "docs"), { recursive: true });
    execFileSync("git", ["-C", path.join(root, repo), "init", "-q"]);
  }
  await mkdir(path.join(root, "docs"), { recursive: true });
  await mkdir(path.join(root, "notes"), { recursive: true });
  await writeFile(path.join(root, "api", "docs", "design.md"), "# Design\n\n## Auth\n\nTokens.\n");
  await writeFile(path.join(root, "web", "README.md"), "# Web\n\nThe site.\n");
  await writeFile(path.join(root, "docs", "other.md"), "# Other\n\nNotes.\n");
  await writeFile(path.join(root, "notes", "n.md"), "# N\n\nx\n");

  const files = new Map<string, Line[]>();
  const add = (home: string, line: Line) => {
    const list = files.get(home) ?? [];
    list.push(line);
    files.set(home, list);
  };
  let seq = 0;
  let n = 0;
  const seeded: Seeded[] = [];
  const at = (days: number) => new Date(Date.UTC(2026, 10, 1 + days, 10)).toISOString();

  const decision = (kind: Kind, topic: string, answer: string, extra: Line, home = "") => {
    const id = randomUUID();
    const line: Line = {
      id,
      at: at(n % 15),
      dev: "mac-b",
      seq: seq++,
      kind: kind === "finding" ? "finding" : "decision",
      scope: `section:${DOC_REL}#Plan › Pricing`,
      ref: null,
      ...(kind === "finding"
        ? { claim: `The ${topic} report goes to ${answer}.`, source: "routing.csv" }
        : {
            decision: `The ${topic} report goes to ${answer}.`,
            quote: `send the ${topic} report to ${answer}`,
            instead: null,
            until: null,
            who: "Priya",
          }),
      ...extra,
    };
    add(home, line);
    seeded.push({ id, kind, topic, answer, at: String(line.at) });
    return id;
  };

  for (const [kind, count] of COUNTS) {
    for (let i = 0; i < count; i++, n++) {
      const topic = `K-${String(n + 1).padStart(3, "0")}`;
      const answer = word(n);
      switch (kind) {
        case "own":
        case "finding":
          decision(kind, topic, answer, {});
          break;
        case "above":
          decision(kind, topic, answer, { scope: `section:${DOC_REL}#Plan` });
          break;
        case "doc":
          decision(kind, topic, answer, { scope: `section:${DOC_REL}#` });
          break;
        case "repo":
          decision(kind, topic, answer, { scope: "repo" });
          break;
        case "folder":
          decision(kind, topic, answer, { scope: "folder:docs" });
          break;
        case "everywhere":
          decision(kind, topic, answer, { scope: "everywhere" }, "~");
          break;
        case "sibling":
          decision(kind, topic, answer, { scope: `section:${DOC_REL}#Plan › Launch` });
          break;
        case "other-doc":
          decision(kind, topic, answer, { scope: "section:docs/other.md#" });
          break;
        case "other-folder":
          decision(kind, topic, answer, { scope: "folder:notes" });
          break;
        case "other-repo":
          decision(kind, topic, answer, { scope: "repo" }, "api");
          break;
        case "other-repo-doc":
          decision(kind, topic, answer, { scope: "section:docs/design.md#Design › Auth" }, "api");
          break;
        case "third-repo":
          decision(kind, topic, answer, { scope: "repo" }, "web");
          break;
        case "lapsed":
          decision(kind, topic, answer, { until: "1 October 2026" });
          break;
        case "dropped": {
          const id = decision(kind, topic, answer, {});
          add("", {
            id: randomUUID(),
            at: at(20),
            dev: "mac-b",
            seq: seq++,
            kind: "dropped",
            target: id,
          });
          break;
        }
        case "replaced": {
          // The old one is dropped; the new one, about the same topic, replaces it.
          const old = decision(kind, topic, answer, {});
          add("", {
            id: randomUUID(),
            at: at(21),
            dev: "mac-b",
            seq: seq++,
            kind: "dropped",
            target: old,
          });
          n++;
          decision("replacing", topic, word(n), {
            at: at(21),
            instead: `The ${topic} report goes to ${answer}.`,
          });
          break;
        }
        case "disputed": {
          // Two people, two answers, the later naming the earlier (18.4): both show.
          if (i % 2 === 1) break;
          const first = decision(kind, topic, answer, {});
          n++;
          decision(kind, topic, word(n), { against: first, who: "Sam", at: at(16) });
          i++;
          break;
        }
        case "gone":
          decision(kind, topic, answer, { scope: `section:${DOC_REL}#Plan › Old pricing` });
          break;
        default:
          break;
      }
    }
  }
  // Not decisions: a PR check's line (24.1), and a torn last line.
  for (let i = 0; i < 5; i++)
    add("", {
      id: randomUUID(),
      at: at(22),
      dev: "mac-b",
      seq: seq++,
      kind: "against",
      target: seeded[i]?.id ?? "x",
      task: `task-${String(i)}`,
      file: null,
      line: null,
      why: `The K-90${String(i)} report goes to ${STALE}.`,
      confidence: 0.9,
      status: "asserted",
    });

  for (const [home, lines] of files) {
    const dir =
      home === "~"
        ? path.join(personal, ".anur", "decisions")
        : path.join(root, home, ".anur", "decisions");
    await mkdir(dir, { recursive: true });
    const text = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
    await writeFile(
      path.join(dir, "priya.jsonl"),
      home === "" ? `${text}{"id":"torn","kind":"decis` : text,
    );
  }
  return { seeded, stale: STALE };
}
