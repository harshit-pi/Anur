import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { edgesIn, matches, normalise, routeTree } from "./edges.ts";
import { git, makeRepo, twoRepoSystem } from "./fixtures.ts";
import { repoIdsOf, scanSystem } from "./system.ts";

const tmp = () => mkdtempSync(path.join(tmpdir(), "anur-edges-"));
const edges = (dir: string) => {
  const scan = scanSystem(dir);
  return edgesIn(
    dir,
    scan.repos.map((r) => r.dir),
    scan.parts,
  );
};

describe("edges between repos (group 22)", () => {
  it("finds every edge the two-repo fixture lists, and none it doesn't", () => {
    const dir = tmp();
    const want = twoRepoSystem(dir);
    const got = edges(dir);
    expect(
      got.map((e) => ({
        from: e.from.repo,
        to: "repo" in e.to ? e.to.repo : e.to.name,
        route: e.route,
        file: e.evidence.split(":")[0],
      })),
    ).toEqual(want.edges);
    expect(got[0]).toMatchObject({ how: "found", declared: "api/src/routes.ts:1" });
  });

  it("reads Amplify calls, nested route trees, CDK resources and outside services", () => {
    const dir = tmp();
    makeRepo(
      path.join(dir, "auth"),
      {
        "pyproject.toml": '[project]\nname = "auth"\n',
        "lib/routes.py": [
          "ROUTES = [",
          "    RouteConfig(",
          '        base_path="user",',
          "        children=[",
          '            RouteConfig(base_path="portfolios", methods={"GET": m}, children=[',
          '                RouteConfig(base_path="{portfolioId}", methods={"GET": m}),',
          "            ]),",
          '            RouteConfig(base_path="details", methods={"GET": m}),',
          "        ],",
          "    ),",
          '    RouteConfig(base_path="health", methods={"GET": m}),',
          "]",
        ].join("\n"),
      },
      null,
    );
    makeRepo(
      path.join(dir, "hooks"),
      {
        "package.json": '{"name":"hooks"}',
        "stacks/api.ts": [
          'const api = new RestApi(this, "Api");',
          'const eca = api.root.addResource("eca");',
          'eca.addResource("v2");',
        ].join("\n"),
      },
      null,
    );
    makeRepo(
      path.join(dir, "app"),
      {
        "package.json": '{"name":"app"}',
        "src/api.ts": [
          'import { get, post } from "aws-amplify/api";',
          'export const a = () => get({ apiName: API_NAME, options: {}, path: "/user/portfolios" });',
          "export const b = (id: string) => get({ apiName: API_NAME, path: `/user/portfolios/${id}` });",
          'export const c = () => fetch("https://hooks.example.dev/eca/v2", { method: "POST" });',
          'export const d = () => fetch("https://api.stripe.com/v1/charges");',
        ].join("\n"),
        "src/api.test.ts": 'get({ path: "/user/details" });\n',
      },
      null,
    );
    const got = edges(dir).map((e) => [
      e.from.repo,
      "repo" in e.to ? e.to.repo : `${e.to.stub}:${e.to.name}`,
      e.route,
      e.how,
    ]);
    expect(got).toEqual([
      ["app", "auth", "/user/portfolios", "found"],
      ["app", "auth", "/user/portfolios/*", "found"],
      ["app", "hooks", "/eca/v2", "found"],
      ["app", "outside:api.stripe.com", "/v1/charges", "found"],
    ]);
    git(path.join(dir, "app"), "status");
  });

  it("normalises and matches paths, a parameter matching one segment", () => {
    expect(normalise("/user/:id/x?y=1")).toBe("/user/*/x");
    expect(normalise("/")).toBe("");
    expect(matches("/user/*/x", "/user/*/x")).toBe(true);
    expect(matches("/user/42/x", "/user/*/x")).toBe(true); // A literal id fills the route's parameter.
    expect(matches("/user/42", "/user/*/x")).toBe(false);
    expect(matches("/user/*", "/user/details")).toBe(true);
    expect(
      routeTree('A(base_path="a", children=[B(base_path="b")])\nC(base_path="c")').map(
        (r) => r.route,
      ),
    ).toEqual(["/a", "/a/b", "/c"]);
  });
});

describe("a line's ID on every Mac (23.12)", () => {
  it("is the same however the repos were cloned, and keeps its folder-named ID as an alias", () => {
    const a = tmp();
    twoRepoSystem(a);
    // The same repos on a teammate's Mac, cloned under other folder names.
    const b = tmp();
    cpSync(path.join(a, "api"), path.join(b, "api-service"), { recursive: true });
    cpSync(path.join(a, "web"), path.join(b, "site"), { recursive: true });
    const lines = (dir: string) => {
      const scan = scanSystem(dir);
      return edgesIn(
        dir,
        scan.repos.map((r) => r.dir),
        scan.parts,
        repoIdsOf(scan),
      );
    };
    const mine = lines(a);
    const theirs = lines(b);
    expect(mine.map((e) => e.id)).toEqual(theirs.map((e) => e.id));
    expect(mine[0]?.id).not.toContain("web/");
    // Decisions and hidden lines saved before still find it.
    expect(mine[0]?.aliases).toEqual(["web/@acme/web|api/@acme/api|http|/v1/users"]);
    expect(theirs[0]?.aliases).toEqual(["site/@acme/web|api-service/@acme/api|http|/v1/users"]);
  });
});
