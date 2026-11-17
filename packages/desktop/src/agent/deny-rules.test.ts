import path from "node:path";
import { describe, expect, it } from "vitest";
import { decide, type HookConfig } from "./hook-rules.ts";
import { denies, denyRulesOf, patternRegExp } from "./deny-rules.ts";

const opts = { project: "/Users/p/Vault", cwd: "/Users/p/Vault", home: "/Users/p" };

describe("the person's deny rules", () => {
  it("reads Read and Edit rules, with each kind of path", () => {
    const rules = denyRulesOf(
      {
        permissions: {
          deny: [
            "Read(./private/**)",
            "Edit(/drafts/*.md)",
            "Read(~/notes/secret.md)",
            "Read(//etc/hosts)",
            "Bash(rm:*)",
            "WebFetch",
          ],
        },
      },
      opts,
    );
    expect(rules.map((r) => [r.kind, r.pattern])).toEqual([
      ["read", "/Users/p/Vault/private/**"],
      ["edit", "/Users/p/Vault/drafts/*.md"],
      ["read", "/Users/p/notes/secret.md"],
      ["read", "/etc/hosts"],
    ]);
  });

  it("matches gitignore-style patterns", () => {
    expect(patternRegExp("/v/private/**").test("/v/private/a/b.md")).toBe(true);
    expect(patternRegExp("/v/drafts/*.md").test("/v/drafts/x.md")).toBe(true);
    expect(patternRegExp("/v/drafts/*.md").test("/v/drafts/deep/x.md")).toBe(false);
    expect(patternRegExp("/v/**/secret.md").test("/v/secret.md")).toBe(true);
    expect(patternRegExp("/v/private").test("/v/private/a.md")).toBe(true);
  });

  it("are held against a doc's working copy", () => {
    const rules = denyRulesOf(
      { permissions: { deny: ["Read(./private/**)", "Edit(./plan.md)"] } },
      opts,
    );
    const config: HookConfig = {
      folder: "/Users/p/Vault",
      anurDir: "/Users/p/Vault/.anur",
      thread: "t1",
      log: "/tmp/log",
      copies: "/support/copies/t1",
      copiesRoot: "/support/copies",
      denies: rules,
    };
    const call = (tool_name: string, file: string) =>
      decide({ tool_name, tool_input: { file_path: file } }, config, (p, cwd) =>
        path.resolve(cwd, p),
      )?.reason ?? null;
    expect(call("Read", "/support/copies/t1/private/a.md")).toContain("Read(./private/**)");
    expect(call("Read", "/support/copies/t1/plan.md")).toBeNull();
    expect(call("Edit", "/support/copies/t1/plan.md")).toContain("Edit(./plan.md)");
    expect(call("Edit", "/support/copies/t1/other.md")).toBeNull();
    expect(denies(rules, "read", "/Users/p/Vault/notes.md")).toBeNull();
  });
});
