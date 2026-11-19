import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { aboutFiles, filesFrom } from "./about.ts";
import { twoRepoSystem } from "./fixtures.ts";

const tmp = () => mkdtempSync(path.join(tmpdir(), "anur-about-"));

describe("what a decision is about, from its files (23.1)", () => {
  it("names the one part holding every file", () => {
    const dir = tmp();
    twoRepoSystem(dir);
    expect(aboutFiles(dir, ["api/src/routes.ts", "api/src/auth/session.ts"])).toMatchObject({
      kind: "part",
      on: "@acme/api",
      repo: "api",
      dir: "api",
    });
  });

  it("names the line when the files sit on both ends of one, from either side", () => {
    const dir = tmp();
    twoRepoSystem(dir);
    const about = aboutFiles(dir, ["web/src/api.ts", "api/src/routes.ts"]);
    expect(about).toMatchObject({
      kind: "edge",
      on: "@acme/web → @acme/api: /v1/users",
      repo: "api",
    });
    expect(about?.scope).toMatch(/^edge:/);
    // Lines given are read as the files that hold them.
    expect(aboutFiles(dir, ["web/src/api.ts:1", "api/src/routes.ts:1"])?.scope).toBe(about?.scope);
  });

  it("is the repo's, not a part's, when a file is in no part or parts no line joins", () => {
    const dir = tmp();
    twoRepoSystem(dir);
    expect(aboutFiles(dir, [])).toBeNull();
    expect(aboutFiles(dir, ["README.md"])).toBeNull();
    expect(aboutFiles(dir, ["api/infra/app.py", "web/src/api.ts"])).toBeNull();
  });

  it("reads files from the session's own folder and drops ones outside", () => {
    expect(filesFrom("/s", "/s/web", ["src/api.ts", "/s/api/x.ts", "../../etc/hosts"])).toEqual([
      "web/src/api.ts",
      "api/x.ts",
    ]);
  });
});
