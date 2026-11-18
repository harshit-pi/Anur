/**
 * Fixtures for the system scanner (group 20.0): a hand-made two-repo system
 * whose expected parts, edges and file categories are listed, and a
 * deterministic generator for larger systems (four repos in CI; twelve with
 * 100k files once speed at that size is measured, 20.10).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const FIXED_DATE = "2026-01-01T00:00:00Z";

function write(root: string, files: Record<string, string>) {
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(root, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
}

/** git with fixed dates and author, so the same fixture gives the same commit hashes. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.com",
      GIT_COMMITTER_NAME: "Fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.com",
      GIT_AUTHOR_DATE: FIXED_DATE,
      GIT_COMMITTER_DATE: FIXED_DATE,
    },
  });
}

/** Make `dir` a repo of `files`, with one commit and, unless `remote` is null, an origin. */
export function makeRepo(dir: string, files: Record<string, string>, remote: string | null): void {
  write(dir, files);
  git(dir, "init", "-q", "-b", "main");
  if (remote) git(dir, "remote", "add", "origin", remote);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "First");
}

export type Expected = {
  repos: string[];
  parts: { repo: string; kind: "package" | "stack" | "service"; name: string }[];
  /** Calls from one repo to another's route, for edge detection (group 22). */
  edges: { from: string; to: string; route: string; file: string }[];
  /** Each file's category for the change report (21.3a). */
  categories: Record<string, "data" | "auth" | "calls" | "ui" | "other">;
};

/** Two repos, a web app calling an API, with everything a test should find listed. */
export function twoRepoSystem(folder: string): Expected {
  makeRepo(
    path.join(folder, "api"),
    {
      "package.json": JSON.stringify({ name: "@acme/api" }, null, 2),
      "cdk.json": JSON.stringify({ app: "npx ts-node bin/app.ts" }),
      "bin/app.ts": 'const app = new App();\nnew ApiStack(app, "AcmeApi");\n',
      "src/routes.ts": 'router.get("/v1/users", listUsers);\nrouter.post("/v1/session", signIn);\n',
      "src/auth/session.ts": "export function signIn() {}\n",
      "migrations/001_users.sql": "create table users (id text primary key);\n",
      ".env.example": "DATABASE_URL=postgres://localhost/acme\n",
      "infra/cdk.json": JSON.stringify({ app: "python3 app.py" }),
      "infra/app.py":
        'AlertsStack(\n    app,\n    "AcmeAlerts",\n    env=env,\n)\nStageStack(app, f"{stage}-Stage")\n',
    },
    "git@github.com:acme/api.git",
  );
  makeRepo(
    path.join(folder, "web"),
    {
      "package.json": JSON.stringify({ name: "@acme/web" }, null, 2),
      "src/api.ts": "export const users = () => fetch(`${process.env.API_URL}/v1/users`);\n",
      "src/components/Users.tsx": "export function Users() { return null; }\n",
      "src/styles.css": ".users { color: black; }\n",
      ".env.example": "API_URL=https://api.acme.test\n",
    },
    "https://github.com/acme/web.git",
  );
  return {
    repos: ["api", "web"],
    parts: [
      { repo: "api", kind: "package", name: "@acme/api" },
      { repo: "api", kind: "stack", name: "AcmeAlerts" },
      { repo: "api", kind: "stack", name: "AcmeApi" },
      { repo: "web", kind: "package", name: "@acme/web" },
    ],
    edges: [{ from: "web", to: "api", route: "/v1/users", file: "web/src/api.ts" }],
    categories: {
      "api/migrations/001_users.sql": "data",
      "api/src/auth/session.ts": "auth",
      "api/src/routes.ts": "other",
      "web/src/api.ts": "calls",
      "web/src/components/Users.tsx": "ui",
      "web/src/styles.css": "ui",
    },
  };
}

/**
 * A system of `repos` repos, deterministic. Repo 0 is a monorepo of
 * `packagesPerRepo` packages; repo 1 has a CDK app with two stacks and no
 * remote; the rest are one package each. Each package holds
 * `filesPerPackage` source files, some calling the next repo's API.
 */
export function generateSystem(
  folder: string,
  opts: { repos: number; packagesPerRepo: number; filesPerPackage: number },
): Expected {
  const expected: Expected = { repos: [], parts: [], edges: [], categories: {} };
  for (let r = 0; r < opts.repos; r++) {
    const name = `repo-${String(r).padStart(2, "0")}`;
    const next = `repo-${String((r + 1) % opts.repos).padStart(2, "0")}`;
    const files: Record<string, string> = {};
    const pkgs = r === 0 ? opts.packagesPerRepo : 1;
    const pkgDir = (i: number) => (r === 0 ? `packages/p${String(i)}/` : "");
    if (r === 0)
      files["package.json"] = JSON.stringify({ name, private: true, workspaces: ["packages/*"] });
    for (let i = 0; i < pkgs; i++) {
      const pkg = r === 0 ? `@sys/${name}-p${String(i)}` : `@sys/${name}`;
      files[`${pkgDir(i)}package.json`] = JSON.stringify({ name: pkg });
      expected.parts.push({ repo: name, kind: "package", name: pkg });
      for (let f = 0; f < opts.filesPerPackage; f++)
        files[`${pkgDir(i)}src/m${String(f)}.ts`] =
          f === 0
            ? `export const call = () => fetch(\`\${process.env.API_URL}/v1/${next}\`);\n`
            : `export const v${String(f)} = ${String(f)};\n`;
    }
    if (r === 1) {
      files["cdk.json"] = JSON.stringify({ app: "npx ts-node bin/app.ts" });
      files["bin/app.ts"] = 'new DataStack(app, "SysData");\nnew ApiStack(app, "SysApi");\n';
      expected.parts.push({ repo: name, kind: "stack", name: "SysData" });
      expected.parts.push({ repo: name, kind: "stack", name: "SysApi" });
    }
    makeRepo(path.join(folder, name), files, r === 1 ? null : `git@github.com:sys/${name}.git`);
    expected.repos.push(name);
  }
  return expected;
}
