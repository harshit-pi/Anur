/**
 * The app eval: scenarios.ts run in the built Anur Dev app, clicked and typed
 * as a person would, with the person's real agent, each on a fresh copy of
 * its doc. No model grades it; each check reads the screen or the files.
 *
 *   pnpm --filter @anur/desktop build && pnpm eval:app [scenario,…]
 *
 * Each run spends the person's tokens (a few minutes of agent work per
 * scenario), so it runs on demand, never in CI. Results go to
 * evals/app/results/<time>.json, with screenshots and the folder as left
 * in evals/app/results/<time>/ (not committed).
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { APP_DIR, Session } from "./app.ts";
import { PLAN, SCENARIOS } from "./scenarios.ts";

type Result = {
  id: string;
  holds: boolean;
  says: string;
  known: string | null;
  seen?: unknown;
};

if (!existsSync(path.join(APP_DIR, "out", "main", "index.js"))) {
  console.error("Build the app first: pnpm --filter @anur/desktop build");
  process.exit(1);
}
const wanted = process.argv[2]?.split(",") ?? null;
const chosen = SCENARIOS.filter((s) => !wanted || wanted.includes(s.name));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dir = path.join(import.meta.dirname, "results");
const runDir = path.join(dir, stamp);
await mkdir(runDir, { recursive: true });

const report: {
  at: string;
  scenarios: { name: string; about: string; secs: number; results: Result[]; errors: string[] }[];
} = { at: new Date().toISOString(), scenarios: [] };
for (const sc of chosen) {
  const started = Date.now();
  const results: Result[] = [];
  const shots = path.join(runDir, sc.name);
  console.log(`\n${sc.name}: ${sc.about}`);
  const s = await Session.open({ "Launch Plan.md": PLAN }, "Launch Plan.md", shots);
  const check = (id: string, holds: boolean, says: string, seen?: unknown) => {
    const known = sc.known?.[id] ?? null;
    results.push({ id, holds, says, known, ...(holds ? {} : { seen }) });
    console.log(
      `  ${holds ? "✓" : known ? "○" : "✗"} ${id}: ${says}${!holds && known ? ` (known: ${known})` : ""}`,
    );
  };
  try {
    await sc.run(s, check);
  } catch (e) {
    check("ran", false, "The scenario ran to its end", String(e));
  }
  await s.keep(path.join(shots, "folder")).catch(() => undefined);
  await s.close();
  report.scenarios.push({
    name: sc.name,
    about: sc.about,
    secs: Math.round((Date.now() - started) / 1000),
    results,
    errors: s.errors,
  });
}
await writeFile(path.join(dir, `${stamp}.json`), `${JSON.stringify(report, null, 2)}\n`);
const all = report.scenarios.flatMap((x) => x.results);
const broke = all.filter((r) => !r.holds && !r.known);
const known = all.filter((r) => !r.holds && r.known);
console.log(
  `\n${String(all.length - broke.length - known.length)} hold, ${String(broke.length)} broke, ${String(known.length)} known open. Results: evals/app/results/${stamp}.json`,
);
process.exit(broke.length > 0 ? 1 : 0);
