import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { buildSectionTree, resolveHeading } from "@anur/core";

const run = promisify(execFile);

/** One commit that changed a section, with the section's text in it (5.6). */
export type CommitVersion = {
  hash: string;
  at: string;
  author: string;
  subject: string;
  text: string;
};

/**
 * In a git repo, the commits that changed one section of a doc, newest
 * first: the doc's last `max` commits, each read back, keeping those whose
 * section text differs from the next newer one. Outside a repo, nothing.
 * Reading never writes: restoring one changes the page only.
 */
export async function sectionCommits(
  folder: string,
  rel: string,
  sectionPath: readonly string[],
  max = 30,
): Promise<CommitVersion[]> {
  const git = (args: string[]) =>
    run("git", ["-C", folder, ...args], { maxBuffer: 16 * 1024 * 1024, timeout: 10_000 }).then(
      (r) => r.stdout,
      () => null,
    );
  if ((await git(["rev-parse", "--is-inside-work-tree"]))?.trim() !== "true") return [];
  const log = await git(["log", `-n${String(max)}`, "--format=%H%x09%aI%x09%an%x09%s", "--", rel]);
  if (!log) return [];
  const out: CommitVersion[] = [];
  let newer: string | null = null;
  for (const line of log.split("\n").filter(Boolean)) {
    const [hash = "", at = "", author = "", ...rest] = line.split("\t");
    const body = await git(["show", `${hash}:./${rel}`]);
    if (body === null) continue;
    const tree = buildSectionTree(body, { fileName: path.basename(rel) });
    const want = sectionPath.join("\u0000");
    let index = tree.sections.findIndex((s) => s.path.join("\u0000") === want);
    if (index < 0 && sectionPath.length > 1)
      index = resolveHeading(tree.sections, sectionPath.slice(1).join("#")) ?? -1;
    const s = index >= 0 ? tree.sections[index] : undefined;
    if (!s) continue;
    const text = body.slice(s.subtreeRange.from, s.subtreeRange.to);
    const commit = { hash, at, author, subject: rest.join("\t"), text };
    // Walking back in time: an older commit with the same text is the one that made it.
    if (text === newer) out[out.length - 1] = commit;
    else out.push(commit);
    newer = text;
  }
  return out;
}
