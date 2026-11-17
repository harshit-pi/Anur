// Build corpora/sections/ from real edits in a Markdown repo's git history.
//
//   node scripts/corpus/build-section-corpus.ts <repo> [maxCases]
//
// Each case is one file at two commits, before and after an edit that
// changed its headings. Labels say which old section each new section is,
// worked out from the line diff, not from the matcher, so the matcher can
// be tested against them:
//
//   a. a heading line the diff keeps is the same section;
//   b. a heading removed and one with the same text added elsewhere is a move;
//   c. a changed block with exactly one removed and one added heading is a rename;
//   d. a changed block with several of each is left unknown (-1), not guessed;
//   e. anything else is a new section, or a deleted one.
//
// Cases where the diff and the matcher disagreed were read and judged by
// hand; those verdicts are in corpora/sections-reviewed.json, keyed by a
// hash of commit and file so no file name is published.
//
// The text is scrambled before it is written: every word becomes a random
// token, the same token for the same word throughout a case, so heading
// structure and word overlap survive and nothing readable is published.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSectionTree,
  hasConflictMarkers,
  sectionBodies,
  similarity,
} from "../../packages/core/src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "..", "..", "corpora", "sections");

const [repo, maxArg] = process.argv.slice(2);
if (!repo) {
  console.error("usage: node scripts/corpus/build-section-corpus.ts <repo> [maxCases]");
  process.exit(2);
}
const MAX = Number(maxArg ?? 80);
const git = (...args: string[]) =>
  execFileSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 1 << 28,
    stdio: ["ignore", "pipe", "ignore"],
  });

// ── line diff ────────────────────────────────────────────────────────────

/** Pairs of equal lines (old index, new index) from a longest common subsequence. */
function lcsPairs(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i] as Uint32Array;
    const below = dp[i + 1] as Uint32Array;
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? (below[j + 1] ?? 0) + 1 : Math.max(below[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) i++;
    else j++;
  }
  return pairs;
}

// ── labels ───────────────────────────────────────────────────────────────

type Tree = ReturnType<typeof buildSectionTree>;
const lineOf = (text: string, pos: number) => text.slice(0, pos).split("\n").length - 1;
const headingLines = (text: string, tree: Tree) =>
  tree.sections.map((s) => (s.headingRange ? lineOf(text, s.headingRange.from) : -1));

type Kind = "kept" | "moved" | "renamed" | "added" | "unknown" | "reviewed";

function label(before: string, after: string, tb: Tree, ta: Tree) {
  const oldLines = headingLines(before, tb);
  const newLines = headingLines(after, ta);
  const pairs = lcsPairs(before.split("\n"), after.split("\n"));
  const newOfOld = new Map(pairs.map(([o, n]) => [o, n]));
  const labels: (number | null)[] = ta.sections.map(() => null);
  const kinds: Kind[] = ta.sections.map(() => "added");
  const usedOld = new Set<number>();

  // The title with no heading is the title.
  if (tb.sections[0]?.headingRange === null && ta.sections[0]?.headingRange === null) {
    labels[0] = 0;
    kinds[0] = "kept";
    usedOld.add(0);
  }
  // a. kept heading lines.
  oldLines.forEach((ol, o) => {
    if (ol < 0) return;
    const nl = newOfOld.get(ol);
    const n = nl === undefined ? -1 : newLines.indexOf(nl);
    if (n >= 0) {
      labels[n] = o;
      kinds[n] = "kept";
      usedOld.add(o);
    }
  });
  // b. moves: the same heading text, removed in one place and added in another.
  const lastOf = (t: Tree, i: number) => t.sections[i]?.path.at(-1) ?? "";
  ta.sections.forEach((_, n) => {
    if (labels[n] !== null) return;
    const o = tb.sections.findIndex((_, i) => !usedOld.has(i) && lastOf(tb, i) === lastOf(ta, n));
    if (o >= 0) {
      labels[n] = o;
      kinds[n] = "moved";
      usedOld.add(o);
    }
  });
  // c. renames: removed and added headings in the same changed block, paired in order.
  const anchors: [number, number][] = [
    [-1, -1],
    ...pairs,
    [before.split("\n").length, after.split("\n").length],
  ];
  for (let k = 0; k + 1 < anchors.length; k++) {
    const [o0, n0] = anchors[k] as [number, number];
    const [o1, n1] = anchors[k + 1] as [number, number];
    const removed = oldLines
      .map((l, i) => [l, i] as const)
      .filter(([l, i]) => l > o0 && l < o1 && !usedOld.has(i))
      .map(([, i]) => i);
    const added = newLines
      .map((l, i) => [l, i] as const)
      .filter(([l, i]) => l > n0 && l < n1 && labels[i] === null)
      .map(([, i]) => i);
    const [onlyRemoved] = removed;
    const [onlyAdded] = added;
    if (
      removed.length === 1 &&
      added.length === 1 &&
      onlyRemoved !== undefined &&
      onlyAdded !== undefined
    ) {
      labels[onlyAdded] = onlyRemoved;
      kinds[onlyAdded] = "renamed";
      usedOld.add(onlyRemoved);
    } else if (removed.length > 0) {
      for (const n of added) {
        labels[n] = -1;
        kinds[n] = "unknown";
      }
    }
  }
  const deleted = tb.sections.map((_, i) => i).filter((i) => !usedOld.has(i)).length;
  return { labels, kinds, deleted };
}

// ── scrambling ───────────────────────────────────────────────────────────

const WORD = /[\p{L}\p{N}]+/gu;

/** One case's scrambler: the same token for the same word, case-folded the way the matcher folds. */
function scrambler() {
  const map = new Map<string, string>();
  const used = new Set<string>();
  // Digits stay digits, so ordered lists stay lists: each digit is swapped
  // for another by one random permutation, which keeps distinct numbers distinct.
  const digits = Array.from({ length: 10 }, (_, i) => String(i));
  for (let i = digits.length - 1; i > 0; i--) {
    const j = (randomBytes(1)[0] ?? 0) % (i + 1);
    [digits[i], digits[j]] = [digits[j] ?? "0", digits[i] ?? "0"];
  }
  const token = (word: string) => {
    if (/^[0-9]+$/.test(word)) return word.replace(/[0-9]/g, (x) => digits[Number(x)] ?? x);
    let t: string;
    do
      t = [...randomBytes(Math.max(3, Math.min(word.length, 9)))]
        .map((b) => "abcdefghijklmnopqrstuvwxyz"[b % 26])
        .join("");
    while (used.has(t));
    return t;
  };
  return (text: string) =>
    text.replace(WORD, (w) => {
      const key = w.toLowerCase().normalize("NFKC");
      let t = map.get(key);
      if (!t) {
        t = token(w);
        map.set(key, t);
        used.add(t);
      }
      return t;
    });
}

// ── mining ───────────────────────────────────────────────────────────────

type Edit = { commit: string; from: string; to: string };

function edits(): Edit[] {
  const out: Edit[] = [];
  let commit = "";
  for (const line of git(
    "log",
    "--reverse",
    "-M",
    "--format=commit %H",
    "--name-status",
    "--diff-filter=MR",
    "--",
    "*.md",
  ).split("\n")) {
    if (line.startsWith("commit ")) commit = line.slice(7);
    else if (/^M\t/.test(line)) {
      const p = line.slice(2);
      out.push({ commit, from: p, to: p });
    } else if (/^R\d*\t/.test(line)) {
      const [, from, to] = line.split("\t");
      if (from && to) out.push({ commit, from, to });
    }
  }
  return out;
}

function show(commit: string, file: string): string | null {
  try {
    return git("show", `${commit}:${file}`);
  } catch {
    return null;
  }
}

const reviewed = JSON.parse(
  readFileSync(path.join(OUT, "..", "sections-reviewed.json"), "utf8"),
) as {
  cases: Record<string, { labels: Record<string, number | null>; judgment: number[] }>;
};
const caseKey = (commit: string, file: string) =>
  createHash("sha256").update(`${commit}\u0000${file}`).digest("hex").slice(0, 16);

const cases: object[] = [];
// For checking labels by eye: CORPUS_PLAIN_DIR gets the readable cases. Never commit it.
const plain: object[] = [];
const stats = {
  scanned: 0,
  kept: 0,
  moved: 0,
  renamed: 0,
  added: 0,
  unknown: 0,
  reviewed: 0,
  deleted: 0,
};
const seen = new Set<string>();

for (const e of edits()) {
  if (cases.length >= MAX) break;
  stats.scanned++;
  const before = show(`${e.commit}^`, e.from);
  const after = show(e.commit, e.to);
  if (before === null || after === null || before === after) continue;
  if (before.length > 60_000 || after.length > 60_000) continue;
  if (hasConflictMarkers(before) || hasConflictMarkers(after)) continue;
  const tb = buildSectionTree(before, { fileName: path.basename(e.from) });
  const ta = buildSectionTree(after, { fileName: path.basename(e.to) });
  const pathsB = tb.sections.map((s) => s.path.join("\u0000")).join("\n");
  const pathsA = ta.sections.map((s) => s.path.join("\u0000")).join("\n");
  if (pathsA === pathsB || tb.sections.length < 2 || ta.sections.length < 2) continue;
  if (seen.has(pathsB + "\n\n" + pathsA)) continue;
  seen.add(pathsB + "\n\n" + pathsA);

  const { labels, kinds, deleted } = label(before, after, tb, ta);
  const review = reviewed.cases[caseKey(e.commit, e.to)];
  for (const [n, o] of Object.entries(review?.labels ?? {})) {
    labels[Number(n)] = o;
    kinds[Number(n)] = "reviewed";
  }
  const scramble = scrambler();
  const sBefore = scramble(before);
  const sAfter = scramble(after);

  // The scrambled pair must draw the same trees and give the same similarities.
  const sb = buildSectionTree(sBefore, { fileName: "before.md" });
  const sa = buildSectionTree(sAfter, { fileName: "after.md" });
  const shape = (t: Tree) =>
    t.sections.map((s) => `${String(s.level)}:${String(s.parent)}:${String(s.ordinal)}`).join(",");
  if (shape(sb) !== shape(tb) || shape(sa) !== shape(ta)) continue;
  const [bb, ba, sbb, sba] = [
    sectionBodies(before, tb),
    sectionBodies(after, ta),
    sectionBodies(sBefore, sb),
    sectionBodies(sAfter, sa),
  ];
  const sameSimilarity = bb.every((b, i) =>
    ba.every((a, j) => Math.abs(similarity(b, a) - similarity(sbb[i] ?? "", sba[j] ?? "")) < 1e-9),
  );
  if (!sameSimilarity) continue;

  for (const k of kinds) stats[k]++;
  stats.deleted += deleted;
  const counts = Object.fromEntries(
    (["kept", "moved", "renamed", "added", "unknown", "reviewed"] as const).map((k) => [
      k,
      kinds.filter((x) => x === k).length,
    ]),
  );
  cases.push({ before: sBefore, after: sAfter, labels, kinds, counts: { ...counts, deleted } });
  plain.push({
    key: caseKey(e.commit, e.to),
    file: e.to,
    commit: e.commit,
    before,
    after,
    labels,
    kinds,
  });
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cases.forEach((c, i) => {
  writeFileSync(
    path.join(OUT, `${String(i + 1).padStart(3, "0")}.json`),
    `${JSON.stringify(c, null, 2)}\n`,
  );
});
const plainDir = process.env.CORPUS_PLAIN_DIR;
if (plainDir) {
  mkdirSync(plainDir, { recursive: true });
  plain.forEach((c, i) => {
    writeFileSync(
      path.join(plainDir, `${String(i + 1).padStart(3, "0")}.json`),
      JSON.stringify(c, null, 2),
    );
  });
}
console.log(JSON.stringify({ cases: cases.length, ...stats }));
console.log(readdirSync(OUT).length, "files in", OUT);
