import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateSystem, git, twoRepoSystem } from "./fixtures.ts";
import { handleHook } from "./hook.ts";
import { categoryOf, folderFor, markTask, reportSince } from "./tasks.ts";
import { scanSystem } from "./system.ts";

const tmp = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "anur-tasks-"));
  mkdirSync(path.join(dir, ".anur"));
  return dir;
};
const touch = (folder: string, rel: string, line: string) => {
  appendFileSync(path.join(folder, rel), line + "\n");
};

describe("the change report (group 21)", () => {
  it("puts every changed file of the fixture in its category, data first, across both repos", async () => {
    const dir = tmp();
    const want = twoRepoSystem(dir);
    const start = await handleHook({
      hook_event_name: "UserPromptSubmit",
      session_id: "s1",
      cwd: path.join(dir, "web"),
      prompt: "go",
    });
    expect(start.kind).toBe("marked");
    // The task touches files in both repos, though it ran in web.
    touch(dir, "api/migrations/001_users.sql", "alter table users add column email text;");
    touch(dir, "api/src/auth/session.ts", "export function signOut() {}");
    touch(dir, "api/src/routes.ts", 'router.get("/v1/health", ok);');
    touch(dir, "web/src/api.ts", "export const me = () => fetch(`${process.env.API_URL}/v1/me`);");
    touch(dir, "web/src/components/Users.tsx", "export const X = 1;");
    touch(dir, "web/src/styles.css", ".x { color: red; }");
    const end = await handleHook({
      hook_event_name: "Stop",
      session_id: "s1",
      cwd: path.join(dir, "web"),
    });
    if (end.kind !== "reported") throw new Error(end.kind);
    const got = Object.fromEntries(end.report.lines.map((l) => [l.file, l.category]));
    expect(got).toEqual(want.categories);
    expect(end.report.lines.map((l) => l.category)).toEqual([
      "data",
      "auth",
      "calls",
      "ui",
      "ui",
      "other",
    ]);
    expect(end.report.repos.map((r) => r.dir)).toEqual(["api", "web"]);
    const sql = end.report.lines[0];
    expect(sql).toMatchObject({ repo: "api", part: "@acme/api", line: 2, how: "changed" });
    expect(sql?.text).toContain("alter table users");
    expect((JSON.parse(readFileSync(end.file, "utf8")) as { id: string }).id).toBe(end.report.id);
  });

  it("writes no report when the task changed nothing, and ignores what was dirty before it", async () => {
    const dir = tmp();
    twoRepoSystem(dir);
    touch(dir, "web/src/styles.css", ".before { color: blue; }"); // Dirty before the task.
    await handleHook({ hook_event_name: "UserPromptSubmit", session_id: "s2", cwd: dir });
    expect((await handleHook({ hook_event_name: "Stop", session_id: "s2", cwd: dir })).kind).toBe(
      "nothing",
    );
    // A file already dirty that the task changes again counts from where it was.
    await handleHook({ hook_event_name: "UserPromptSubmit", session_id: "s2", cwd: dir });
    touch(dir, "web/src/styles.css", ".during { color: green; }");
    const end = await handleHook({ hook_event_name: "Stop", session_id: "s2", cwd: dir });
    if (end.kind !== "reported") throw new Error(end.kind);
    expect(end.report.lines).toHaveLength(1);
    expect(end.report.lines[0]).toMatchObject({ file: "web/src/styles.css", line: 3 });
    expect(end.report.lines[0]?.text).toContain(".during");
  });

  it("counts commits made during the task, new files and deleted ones", () => {
    const dir = tmp();
    twoRepoSystem(dir);
    const mark = markTask(dir, "s3", "ship it");
    writeFileSync(path.join(dir, "api/src/auth/token.ts"), "export const t = 1;\n");
    git(path.join(dir, "api"), "add", "-A");
    git(path.join(dir, "api"), "commit", "-q", "-m", "token");
    git(path.join(dir, "web"), "rm", "-q", "src/styles.css");
    const report = reportSince(dir, mark, scanSystem(dir).parts);
    expect(report?.lines.map((l) => [l.file, l.category, l.how])).toEqual([
      ["api/src/auth/token.ts", "auth", "added"],
      ["web/src/styles.css", "ui", "deleted"],
    ]);
    expect(report?.repos[0]?.from).not.toBe(report?.repos[0]?.to);
  });

  it("reports within 30 s of the task ending, on the four-repo fixture", async () => {
    const dir = tmp();
    const want = generateSystem(dir, { repos: 4, packagesPerRepo: 3, filesPerPackage: 20 });
    await handleHook({ hook_event_name: "UserPromptSubmit", session_id: "s4", cwd: dir });
    const repo = want.repos[2] ?? "";
    writeFileSync(path.join(dir, repo, "schema.sql"), "create table t (id int);\n");
    const t0 = Date.now();
    const end = await handleHook({ hook_event_name: "Stop", session_id: "s4", cwd: dir });
    expect(Date.now() - t0).toBeLessThan(30_000);
    expect(end.kind).toBe("reported");
  });

  it("finds the opened folder above a repo, the outermost one holding .anur", () => {
    const dir = tmp();
    twoRepoSystem(dir);
    mkdirSync(path.join(dir, "web", ".anur"));
    expect(folderFor(path.join(dir, "web", "src"), "/")).toBe(dir);
    expect(folderFor(tmpdir(), "/")).toBeNull();
  });

  it("reads categories from what was added, not only the path", () => {
    expect(categoryOf("api/src/stack.ts", "new dynamodb.Table(this, 'Orders', {})")).toBe("data");
    expect(categoryOf("api/src/users.ts", "import { verify } from './jwt';")).toBe("auth");
    expect(categoryOf("jobs/charge.py", "requests.post(url, json=body)")).toBe("calls");
    expect(categoryOf("web/Badge.tsx", "const r = await fetch('/x')")).toBe("calls");
    expect(categoryOf("README.md", "words")).toBe("other");
  });
});

describe("Claude's choices at task end (21.3)", () => {
  it("reads the Choices list from the transcript's last reply into the report", async () => {
    const dir = tmp();
    twoRepoSystem(dir);
    const start = await handleHook({
      hook_event_name: "UserPromptSubmit",
      session_id: "s5",
      cwd: dir,
    });
    expect(start.kind === "marked" && start.context).toContain("Choices:");
    touch(dir, "web/src/styles.css", ".x {}");
    const transcript = path.join(dir, "t.jsonl");
    const line = (text: string) =>
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text }] },
      });
    writeFileSync(
      transcript,
      [
        line("Choices:\n- an old one"),
        JSON.stringify({ type: "user", message: { role: "user", content: "next" } }),
        line(
          "Done.\n\n**Choices:**\n- Run the job at 2am UTC\n- Skip cards marked **expired**\n\nThat's all.",
        ),
      ].join("\n"),
    );
    const end = await handleHook({
      hook_event_name: "Stop",
      session_id: "s5",
      cwd: dir,
      transcript_path: transcript,
    });
    if (end.kind !== "reported") throw new Error(end.kind);
    expect(end.report.choices).toEqual(["Run the job at 2am UTC", "Skip cards marked expired"]);
  });
});

describe("each line points at what changed", () => {
  it("skips blank added lines to the first one with words", () => {
    const dir = tmp();
    twoRepoSystem(dir);
    const mark = markTask(dir, "s6", "");
    touch(dir, "api/src/auth/session.ts", "\nexport function signOut() {}");
    const report = reportSince(dir, mark, scanSystem(dir).parts);
    expect(report?.lines[0]).toMatchObject({ line: 3, text: "export function signOut() {}" });
  });
});

describe("the report's calls come from edges (22.5)", () => {
  it("says what a changed file calls in another repo", async () => {
    const dir = tmp();
    twoRepoSystem(dir);
    await handleHook({ hook_event_name: "UserPromptSubmit", session_id: "s7", cwd: dir });
    touch(
      dir,
      "web/src/api.ts",
      "export const login = () => fetch(`${process.env.API_URL}/v1/session`);",
    );
    touch(dir, "web/src/components/Users.tsx", "export const Y = 2;");
    const end = await handleHook({ hook_event_name: "Stop", session_id: "s7", cwd: dir });
    if (end.kind !== "reported") throw new Error(end.kind);
    expect(end.report.lines.map((l) => [l.file, l.category, l.calls])).toEqual([
      ["web/src/api.ts", "calls", ["api /v1/session", "api /v1/users"]],
      ["web/src/components/Users.tsx", "ui", undefined],
    ]);
  });
});

describe("Anur's own questions aren't tasks", () => {
  it("skips a prompt carrying the internal mark, so its Stop writes nothing", async () => {
    const dir = tmp();
    twoRepoSystem(dir);
    const start = await handleHook({
      hook_event_name: "UserPromptSubmit",
      session_id: "s8",
      cwd: dir,
      prompt: "[anur:internal] You are naming groups",
    });
    expect(start.kind).toBe("skipped");
    touch(dir, "web/src/styles.css", ".z {}");
    expect((await handleHook({ hook_event_name: "Stop", session_id: "s8", cwd: dir })).kind).toBe(
      "skipped",
    );
  });
});

describe("a repo left out of the folder's system", () => {
  it("isn't scanned or marked, and comes back when put back", async () => {
    const { appendReview } = await import("./review.ts");
    const dir = tmp();
    twoRepoSystem(dir);
    appendReview(dir, [{ kind: "repo-excluded", repo: "web", at: "" }]);
    expect(scanSystem(dir).repos.map((r) => r.dir)).toEqual(["api"]);
    const mark = markTask(dir, "s9", "");
    expect(mark.repos.map((r) => r.dir)).toEqual(["api"]);
    touch(dir, "web/src/styles.css", ".q {}");
    expect(reportSince(dir, mark, scanSystem(dir).parts)).toBeNull();
    appendReview(dir, [{ kind: "repo-included", repo: "web", at: "" }]);
    expect(scanSystem(dir).repos.map((r) => r.dir)).toEqual(["api", "web"]);
  });
});

describe("a thread's session isn't one of the person's tasks", () => {
  it("skips every turn of a session Anur started for a thread, by its environment", async () => {
    const dir = tmp();
    twoRepoSystem(dir);
    const env = { ANUR_THREAD_SESSION: "1" };
    const start = await handleHook(
      { hook_event_name: "UserPromptSubmit", session_id: "t1", cwd: dir, prompt: "a later turn" },
      undefined,
      env,
    );
    expect(start.kind).toBe("skipped");
    touch(dir, "api/src/routes.ts", 'router.get("/v1/x", ok);');
    const end = await handleHook(
      { hook_event_name: "Stop", session_id: "t1", cwd: dir },
      undefined,
      env,
    );
    expect(end.kind).toBe("skipped");
  });

  it("skips a thread's first prompt by its title, even without the environment", async () => {
    const dir = tmp();
    twoRepoSystem(dir);
    const r = await handleHook(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "t2",
        cwd: dir,
        prompt: "# Anur: a thread on one section\n\nThis thread is about one section…",
      },
      undefined,
      {},
    );
    expect(r).toEqual({ kind: "skipped", why: "a thread's first prompt" });
    // The person's own task in the same folder is still marked.
    const own = await handleHook(
      { hook_event_name: "UserPromptSubmit", session_id: "p1", cwd: dir, prompt: "add retries" },
      undefined,
      {},
    );
    expect(own.kind).toBe("marked");
  });
});
