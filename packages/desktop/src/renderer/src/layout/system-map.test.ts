import { describe, expect, it } from "vitest";
import { layoutMap } from "./system-map.ts";
import type { SystemEdge, SystemSection } from "./system-levels.ts";

const s = (id: string, path: string[], parent: string | null, text = ""): SystemSection => ({
  id,
  path,
  text,
  parent,
});
const all: SystemSection[] = [
  s("repo:app", ["app"], null),
  s("part:app1", ["app", "app"], "repo:app", "package in package.json"),
  s("repo:auth", ["auth"], null),
  s("group:auth/user", ["auth", "User"], "repo:auth"),
  s("part:a1", ["auth", "UsersApi"], "group:auth/user"),
  s("part:a2", ["auth", "Wallet"], "group:auth/user"),
  s("part:a3", ["auth", "Health"], "repo:auth"),
  s("repo:jobs", ["jobs"], null),
  s("part:j1", ["jobs", "jobs"], "repo:jobs"),
  s("repo:notes", ["notes"], null),
];
const edge = (id: string, from: string, to: string, label = "/x"): SystemEdge => ({
  id,
  from,
  to,
  kind: "http",
  label,
  how: "found",
  evidence: "f:1",
  declared: null,
  state: "shown",
});
const edges = [
  edge("e1", "part:app1", "part:a1", "/user"),
  edge("e2", "part:app1", "part:a2", "/wallet"),
  edge("e3", "part:j1", "part:a3", "/health"),
  edge("e4", "part:app1", "stub:outside:api.stripe.com", "/v1/charges"),
];
const at = (m: ReturnType<typeof layoutMap>, id: string) => m.nodes.find((n) => n.id === id);

describe("the system as a map (24.4)", () => {
  it("puts callers left of what they call, outside services beside their caller, loose repos below", () => {
    const m = layoutMap(all, edges, null, new Set());
    expect(at(m, "repo:app")?.x).toBe(0);
    expect(at(m, "repo:jobs")?.x).toBe(0);
    expect((at(m, "repo:auth")?.x ?? 0) > (at(m, "repo:app")?.x ?? 0)).toBe(true);
    // An outside service sits in the column right of its caller, under that column's repos.
    expect(at(m, "stub:outside:api.stripe.com")?.x).toBe(at(m, "repo:auth")?.x);
    expect((at(m, "stub:outside:api.stripe.com")?.y ?? 0) > (at(m, "repo:auth")?.y ?? 0)).toBe(
      true,
    );
    expect((at(m, "repo:notes")?.y ?? 0) > (at(m, "repo:jobs")?.y ?? 0)).toBe(true);
    expect(m.lines.map((l) => [l.from, l.to, l.label])).toEqual([
      ["repo:app", "repo:auth", "2 calls"],
      ["repo:jobs", "repo:auth", "/health"],
      ["repo:app", "stub:outside:api.stripe.com", "/v1/charges"],
    ]);
  });

  it("opens a repo in place: its parts inside, lines on the parts, the rest grey", () => {
    const m = layoutMap(all, edges, null, new Set(["repo:auth", "group:auth/user"]));
    const auth = at(m, "repo:auth");
    const user = at(m, "part:a1");
    expect(auth?.open).toBe(true);
    expect(user?.parent).toBe("group:auth/user");
    expect((user?.x ?? 0) >= (auth?.x ?? 0) && (user?.y ?? 0) > (auth?.y ?? 0)).toBe(true);
    expect(m.lines.map((l) => [l.from, l.to])).toEqual([
      ["repo:app", "part:a1"],
      ["repo:app", "part:a2"],
      ["repo:jobs", "part:a3"],
      ["repo:app", "stub:outside:api.stripe.com"],
    ]);
    expect(at(m, "repo:notes")?.grey).toBe(true);
    expect(at(m, "repo:app")?.grey).toBe(false);
  });

  it("lays out the same way every time", () => {
    expect(layoutMap(all, edges, null, new Set())).toEqual(
      layoutMap(all, [...edges], null, new Set()),
    );
  });
});

describe("a long tail of outside ends", () => {
  it("folds more than three into one box", () => {
    const many = ["A", "B", "C", "D"].map((n, i) => ({
      ...edge(`t${String(i)}`, "part:app1", `stub:not-cloned:table ${n}`),
      kind: "aws",
    }));
    const m = layoutMap(all, many, null, new Set());
    const stubs = m.nodes.filter((n) => n.kind === "stub");
    expect(stubs.map((n) => [n.name, n.line])).toEqual([
      ["4 not in these repos", "created in no repo here"],
    ]);
    expect(m.lines.map((l) => [l.from, l.to, l.label])).toEqual([
      ["repo:app", "stub:many:not-cloned", "4 links"],
    ]);
  });
});
