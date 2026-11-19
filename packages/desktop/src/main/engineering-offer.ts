import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { SKIP_DIRS } from "@anur/system";

/**
 * Whether a folder looks like code, for the card that offers Engineering:
 * its code repos, counted fast. A repo counts when a build file sits at its
 * root or one folder down, so a git repo of notes, such as a vault, doesn't.
 * The walk stops at a depth and a time budget, so a huge folder never stalls.
 */
const BUILD = [
  "package.json",
  "pyproject.toml",
  "go.mod",
  "Cargo.toml",
  "cdk.json",
  "serverless.yml",
  "pom.xml",
  "build.gradle",
  "Gemfile",
  "composer.json",
];

function looksLikeCode(repo: string): boolean {
  if (BUILD.some((b) => existsSync(path.join(repo, b)))) return true;
  let names: string[];
  try {
    names = readdirSync(repo);
  } catch {
    return false;
  }
  return names.some(
    (n) =>
      !n.startsWith(".") &&
      !SKIP_DIRS.has(n) &&
      BUILD.some((b) => existsSync(path.join(repo, n, b))),
  );
}

export function codeRepos(folder: string, maxDepth = 3, budgetMs = 400): number {
  const until = Date.now() + budgetMs;
  let count = 0;
  const walk = (dir: string, depth: number) => {
    if (Date.now() > until) return;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    if (names.includes(".git")) {
      if (looksLikeCode(dir)) count++;
      return; // A repo's own folders belong to it.
    }
    if (depth >= maxDepth) return;
    for (const n of names)
      if (!n.startsWith(".") && !SKIP_DIRS.has(n)) {
        const p = path.join(dir, n);
        // walk() reads it, and a file or an unreadable folder simply has nothing to read.
        walk(p, depth + 1);
      }
  };
  walk(folder, 0);
  return count;
}
