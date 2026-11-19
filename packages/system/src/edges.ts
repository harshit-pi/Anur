/**
 * Edges between repos (group 22; Design - Engineering Plugin §5): a call
 * from one repo to an HTTP route another repo declares, found in code with
 * its file and line. One detector so far, HTTP; shared packages and CDK
 * references come later (22.6).
 *
 * Routes are read from: Express-style `router.get("/x")`, Flask and FastAPI
 * decorators, CDK `addResource("x")` chains, and nested route trees of
 * `base_path="x"` with `children=[…]`.
 * Calls are read from: `fetch`, axios and got with a literal path or a
 * template whose path is literal, Python `requests` and `httpx`, and
 * Amplify's `get/post/put/del({ path: "/x" })`.
 *
 * It misses, by design: URLs built at run time beyond a literal path, calls
 * through a wrapper the rules don't know, routes registered in a loop, and
 * and hosts not named by a CDK domain.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { partOf } from "./tasks.ts";
import type { Part } from "./parts.ts";

export const HTTP_MISSES = [
  "URLs built at run time beyond a literal path",
  "calls through a wrapper the rules don't know",
  "routes registered in a loop",
  "hosts not named by a CDK domain",
];

export type Route = { repo: string; file: string; line: number; route: string };
export type Call = {
  repo: string;
  file: string;
  line: number;
  /** The path the call names, normalised. */
  route: string;
  method: string | null;
  /** The host, when the URL is absolute. */
  host: string | null;
};

export type Edge = {
  /** Provider, consumer, kind and contract key (Internals §1). */
  id: string;
  kind: "http";
  /** The consumer: who calls. */
  from: { repo: string; part: string | null };
  /** The provider, or a stub outside the folder. */
  to: { repo: string; part: string | null } | { stub: "outside" | "not cloned"; name: string };
  route: string;
  method: string | null;
  /** "found" when one repo declares the route; "guessed" when several might. */
  how: "found" | "guessed";
  /** Where the call is: "file:line", relative to the opened folder. */
  evidence: string;
  /** Where the route is declared, when found. */
  declared: string | null;
  /** The line's earlier IDs, named by repo folders, that saved decisions and choices may use. */
  aliases?: string[];
};

const SRC = ["*.ts", "*.tsx", "*.js", "*.jsx", "*.mjs", "*.cjs", "*.py"];
const TEST =
  /(^|\/)(tests?|__tests__|spec|e2e|fixtures?|mocks?|harness)\/|\.(test|spec|harness)\.[a-z]+$/;

/** `git grep` in a repo: tracked source files only, so ignored output never counts. */
function grep(repo: string, pattern: string): { file: string; line: number; text: string }[] {
  let out: string;
  try {
    out = execFileSync("git", ["grep", "-n", "-I", "-E", "-e", pattern, "--", ...SRC], {
      cwd: repo,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return []; // No match exits 1.
  }
  return out.split("\n").flatMap((l) => {
    const m = /^(.+?):(\d+):(.*)$/.exec(l);
    return m?.[1] && !TEST.test(m[1]) ? [{ file: m[1], line: Number(m[2]), text: m[3] ?? "" }] : [];
  });
}

/** "/user/{id}/x?y=1" and "/user/:id/x" both become "/user/*\/x"; "" for nothing usable. */
export function normalise(p: string): string {
  let s = p.split("?")[0]?.split("#")[0] ?? "";
  s = s
    .replace(/\$\{[^}]*\}/g, "*")
    .replace(/\{[^}]*\}/g, "*")
    .replace(/(^|\/):[A-Za-z_]\w*/g, "$1*");
  s = s.replace(/\/+/g, "/").replace(/\/$/, "");
  if (!s.startsWith("/")) s = "/" + s;
  return s === "/" || s === "/*" ? "" : s;
}

/** Routes one repo declares. */
export function routesIn(folder: string, dir: string): Route[] {
  const repo = path.join(folder, dir);
  const out: Route[] = [];
  const add = (file: string, line: number, r: string) => {
    const route = normalise(r);
    if (route) out.push({ repo: dir, file: path.posix.join(dir, file), line, route });
  };
  // Express, Koa, Fastify, and Flask or FastAPI decorators.
  for (const h of grep(
    repo,
    "(router|app|api|server|blueprint|bp|fastify)[.](get|post|put|patch|delete|route|all)[(][[:space:]]*[\"'`]/",
  )) {
    const m = /\.(get|post|put|patch|delete|route|all)\(\s*["'`](\/[^"'`]*)/.exec(h.text);
    if (m?.[2]) add(h.file, h.line, m[2]);
  }
  // CDK API Gateway: const x = api.root.addResource("a"); x.addResource("b") → /a/b.
  for (const file of new Set(grep(repo, "addResource[(]").map((h) => h.file))) {
    const vars = new Map<string, string>();
    readFileSync(path.join(repo, file), "utf8")
      .split("\n")
      .forEach((text, i) => {
        const m =
          /(?:(?:const|let|var)\s+(\w+)\s*=\s*)?([\w.]+)\.addResource\(\s*["'`]([^"'`]+)["'`]/.exec(
            text,
          );
        if (!m?.[3]) return;
        const parentVar = (m[2] ?? "").split(".")[0] ?? "";
        const base = m[2]?.endsWith(".root") || m[2] === "root" ? "" : (vars.get(parentVar) ?? "");
        const full = `${base}/${m[3]}`;
        if (m[1]) vars.set(m[1], full);
        add(file, i + 1, full);
      });
  }
  // Route trees: base_path="a" nested inside another's children.
  for (const file of new Set(
    grep(repo, "base_path[[:space:]]*=[[:space:]]*[\"']").map((h) => h.file),
  ))
    for (const r of routeTree(readFileSync(path.join(repo, file), "utf8")))
      add(file, r.line, r.route);
  return out;
}

/**
 * Paths in a nested tree of `base_path="x"`, by bracket depth: a node's path
 * is the base paths of the nodes whose brackets still enclose it.
 */
export function routeTree(text: string): { line: number; route: string }[] {
  const out: { line: number; route: string }[] = [];
  const open: { depth: number; seg: string }[] = [];
  let depth = 0;
  let line = 1;
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\n") line++;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "#") {
      while (i < text.length && text[i] !== "\n") i++;
      line++;
      continue;
    }
    const m = /^base_path\s*=\s*["']([^"']*)["']/.exec(text.slice(i, i + 200));
    if (m && /[^\w]/.test(text[i - 1] ?? " ")) {
      while (open.length && (open.at(-1)?.depth ?? 0) >= depth) open.pop();
      open.push({ depth, seg: m[1] ?? "" });
      out.push({
        line,
        route:
          "/" +
          open
            .map((o) => o.seg)
            .filter(Boolean)
            .join("/"),
      });
      i += m[0].length - 1;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      while (open.length && (open.at(-1)?.depth ?? 0) > depth) open.pop();
    }
  }
  return out;
}

/** Calls one repo makes. */
export function callsIn(folder: string, dir: string): Call[] {
  const repo = path.join(folder, dir);
  const out: Call[] = [];
  const add = (file: string, line: number, url: string, method: string | null) => {
    let host: string | null = null;
    let p = url;
    const abs = /^https?:\/\/((?:\$\{[^}]*\}|[^/"'`$])+)(.*)$/.exec(url);
    if (abs) {
      // A host built from a template, cognito-idp.${region}.amazonaws.com, keeps its fixed parts.
      host = (abs[1] ?? "").replace(/\$\{[^}]*\}/g, "x");
      p = abs[2] ?? "";
    } else {
      // A template with a base: `${API_URL}/v1/users` → /v1/users.
      const t = /^\$\{[^}]*\}(.*)$/.exec(url);
      if (t) p = t[1] ?? "";
      else if (!url.startsWith("/")) return;
    }
    const route = normalise(p);
    if (route || host)
      out.push({ repo: dir, file: path.posix.join(dir, file), line, route, method, host });
  };
  for (const h of grep(
    repo,
    "(fetch|axios([.](get|post|put|patch|delete))?|got([.](get|post|put|patch|delete))?|requests[.](get|post|put|patch|delete)|httpx[.](get|post|put|patch|delete))[(][[:space:]]*f?[\"'`]",
  )) {
    const m =
      /(fetch|axios(?:\.(get|post|put|patch|delete))?|got(?:\.(get|post|put|patch|delete))?|requests\.(get|post|put|patch|delete)|httpx\.(get|post|put|patch|delete))\(\s*f?["'`]([^"'`]+)/.exec(
        h.text,
      );
    if (!m?.[6]) continue;
    const method = (m[2] ?? m[3] ?? m[4] ?? m[5] ?? null)?.toUpperCase() ?? null;
    add(h.file, h.line, m[6].replace(/^\{[^}]*\}/, "${base}"), method);
  }
  // Amplify REST: get/post/put/del({ apiName, path: "/x" }) in files that import aws-amplify.
  const amplify = new Set(
    grep(repo, "from [\"'](aws-amplify|@aws-amplify)/api").map((h) => h.file),
  );
  for (const h of grep(repo, "(^|[^A-Za-z_])path:[[:space:]]*[\"'`]/"))
    if (amplify.has(h.file)) {
      const m = /\bpath:\s*["'`](\/[^"'`]*)/.exec(h.text);
      if (m?.[1]) add(h.file, h.line, m[1], null);
    }
  return out;
}

/** Hosts that are outside services, whatever the code calls them. */
const OUTSIDE =
  /(^|\.)(stripe\.com|plaid\.com|twilio\.com|sendgrid\.(com|net)|slack\.com|github\.com|googleapis\.com|openai\.com|anthropic\.com|discord(app)?\.com|polygon\.io|amazonaws\.com)$/;

/**
 * Hosts a repo serves at, from CDK domain names. A `.env.example` names the
 * hosts a repo calls, not the ones it serves, so it isn't read here; a call
 * through `${API_URL}` matches by its path alone.
 */
function hostsOf(folder: string, dir: string): string[] {
  const repo = path.join(folder, dir);
  const hosts: string[] = [];
  for (const h of grep(
    repo,
    `domainName[[:space:]]*[:=][[:space:]]*["'\`][a-z0-9.-]+[.][a-z]{2,}`,
  )) {
    const m = /domainName\s*[:=]\s*["'`]([a-z0-9.-]+)/.exec(h.text);
    if (m?.[1]) hosts.push(m[1]);
  }
  return hosts;
}

/** "api.acme.com" → "acme.com": what two hosts of one team share. */
const baseDomain = (host: string) => host.split(":")[0]?.split(".").slice(-2).join(".") ?? host;

/** Whether a call's route matches a declared route, a `*` matching any one segment. */
export function matches(call: string, route: string): boolean {
  const a = call.split("/");
  const b = route.split("/");
  if (a.length !== b.length) return false;
  return a.every((s, i) => s === b[i] || s === "*" || b[i] === "*");
}

/**
 * Every edge in the folder: each call resolved to the repo that declares its
 * route, never the caller's own. One provider is "found"; several, each
 * "guessed". A call to an outside service is a stub; one no repo declares
 * becomes "not cloned" only when its host is known and not ours.
 */
export function edgesIn(
  folder: string,
  dirs: readonly string[],
  parts: readonly Part[],
  /**
   * Each repo's ID by its folder (its oldest root commit): a line's ID names
   * repos by these, so it's the same on every Mac however the repos were
   * cloned. Without one, a repo is named by its folder, as before.
   */
  repoIds: ReadonlyMap<string, string> = new Map(),
): Edge[] {
  const rk = (d: string) => repoIds.get(d) ?? d;
  const routes = dirs.flatMap((d) => routesIn(folder, d));
  const own = new Map(dirs.map((d) => [d, hostsOf(folder, d)]));
  const edges = new Map<string, Edge>();
  // The ID named by folders, as lines were before repo IDs: kept as an alias,
  // so what was decided or hidden on a line still finds it.
  const put = (e: Edge) => {
    if (edges.has(e.id)) return;
    const legacy = e.id
      .split("|")
      .map((seg, i) => (i < 2 ? unkey(seg) : seg))
      .join("|");
    edges.set(e.id, legacy === e.id ? e : { ...e, aliases: [legacy] });
  };
  const byKey = new Map(dirs.map((d) => [rk(d), d] as const));
  const unkey = (seg: string) => {
    const slash = seg.indexOf("/");
    if (slash < 0) return seg;
    const dir = byKey.get(seg.slice(0, slash));
    return dir === undefined ? seg : `${dir}${seg.slice(slash)}`;
  };
  for (const d of dirs)
    for (const c of callsIn(folder, d)) {
      const from = { repo: c.repo, part: partOf(parts, c.repo, c.file) };
      const evidence = `${c.file}:${String(c.line)}`;
      const fromKey = `${rk(from.repo)}/${from.part ?? ""}`;
      const servedBy = c.host ? dirs.filter((x) => own.get(x)?.includes(c.host ?? "")) : null;
      // A host no repo here serves is an outside service, unless it shares a domain with ours.
      const ours = [...own.values()].flat().map(baseDomain);
      const outside =
        !!c.host &&
        !servedBy?.length &&
        (OUTSIDE.test(c.host) || !ours.includes(baseDomain(c.host)));
      if (
        c.host &&
        outside &&
        !/^(localhost|127\.0\.0\.1)(:|$)|(^|\.)example\.[a-z]+$/.test(c.host)
      ) {
        put({
          id: `${fromKey}|outside:${c.host}|http|${c.route || "/"}`,
          kind: "http",
          from,
          to: { stub: "outside", name: c.host },
          route: c.route || "/",
          method: c.method,
          how: "found",
          evidence,
          declared: null,
        });
        continue;
      }
      // A known host narrows the providers to the repos that serve it.
      const providers = routes.filter(
        (r) =>
          r.repo !== c.repo &&
          c.route &&
          matches(c.route, r.route) &&
          (!servedBy?.length || servedBy.includes(r.repo)),
      );
      const repos = [...new Set(providers.map((r) => r.repo))];
      if (repos.length) {
        for (const repo of repos) {
          const r = providers.find((x) => x.repo === repo);
          if (!r) continue;
          const to = { repo, part: partOf(parts, repo, r.file) };
          put({
            id: `${fromKey}|${rk(to.repo)}/${to.part ?? ""}|http|${r.route}`,
            kind: "http",
            from,
            to,
            route: r.route,
            method: c.method,
            how: repos.length === 1 ? "found" : "guessed",
            evidence,
            declared: `${r.file}:${String(r.line)}`,
          });
        }
      } else if (c.host && !servedBy?.length && ours.includes(baseDomain(c.host))) {
        put({
          id: `${fromKey}|not-cloned:${c.host}|http|${c.route || "/"}`,
          kind: "http",
          from,
          to: { stub: "not cloned", name: c.host },
          route: c.route || "/",
          method: c.method,
          how: "guessed",
          evidence,
          declared: null,
        });
      }
    }
  return [...edges.values()].sort((a, b) => a.id.localeCompare(b.id));
}
