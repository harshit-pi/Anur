/**
 * AWS resources from CDK source (Design - Engineering Plugin §5; 22.6): the
 * Lambdas, tables, queues, topics and buckets each stack creates or imports,
 * and how functions use them: grants, event sources, environment variables.
 * Standard CDK constructs only, in TypeScript and Python, so any CDK team's
 * code reads the same way. A stack's `props.x` (or a Python stack's `x`
 * argument) is followed through the app file to the resource it's given.
 *
 * Misses, by design: names built at run time, resources made by a team's
 * own helper functions, and wiring that isn't in the app file.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

export const AWS_MISSES = [
  "resource names built at run time",
  "resources made by a team's own helper functions",
  "stacks wired outside the CDK app file",
  "a class made by a factory function rather than `new`",
];

export type AwsKind = "function" | "table" | "queue" | "topic" | "bucket";
export type AwsAction =
  "invokes" | "reads" | "writes" | "triggers" | "sends" | "publishes" | "uses";

export type AwsResource = {
  /** Stable within the folder: its physical name when known, else repo, class and construct ID. */
  key: string;
  repo: string;
  kind: AwsKind;
  /** The name a person knows it by: its physical name, else its construct ID. */
  name: string;
  /** Its physical name when the code sets one; how repos share it. */
  physical: string | null;
  /** The stacks it's created in (construct IDs from the app file); empty when unknown. */
  stacks: string[];
  file: string;
  line: number;
  /** Created here, or imported from elsewhere by name. */
  created: boolean;
};

export type AwsUse = {
  repo: string;
  file: string;
  line: number;
  /** The function that acts, by resource key. */
  from: string;
  /** What it acts on, by resource key. */
  to: string;
  action: AwsAction;
};

const KIND: Record<string, AwsKind> = {
  Function: "function",
  NodejsFunction: "function",
  PythonFunction: "function",
  DockerImageFunction: "function",
  SingletonFunction: "function",
  GoFunction: "function",
  Table: "table",
  TableV2: "table",
  Queue: "queue",
  Topic: "topic",
  Bucket: "bucket",
};
const CONSTRUCTS = Object.keys(KIND).join("|");
const NAME_PROP: Record<AwsKind, RegExp> = {
  function: /\b(?:functionName|function_name)\s*[:=]\s*f?["'`]([^"'`${}]+)["'`]/,
  table: /\b(?:tableName|table_name)\s*[:=]\s*f?["'`]([^"'`${}]+)["'`]/,
  queue: /\b(?:queueName|queue_name)\s*[:=]\s*f?["'`]([^"'`${}]+)["'`]/,
  topic: /\b(?:topicName|topic_name)\s*[:=]\s*f?["'`]([^"'`${}]+)["'`]/,
  bucket: /\b(?:bucketName|bucket_name)\s*[:=]\s*f?["'`]([^"'`${}]+)["'`]/,
};
const GRANT: Record<string, AwsAction> = {
  readwritedata: "writes",
  writedata: "writes",
  readdata: "reads",
  invoke: "invokes",
  sendmessages: "sends",
  consumemessages: "reads",
  publish: "publishes",
  read: "reads",
  write: "writes",
  readwrite: "writes",
  put: "writes",
  streamread: "reads",
  fullaccess: "writes",
};

const TEST =
  /(^|\/)(tests?|__tests__|spec|e2e|fixtures?|mocks?|harness)\/|\.(test|spec|harness)\.[a-z]+$/;

function files(repo: string): string[] {
  try {
    return execFileSync(
      "git",
      ["grep", "-l", "-I", "-E", "-e", "aws-cdk-lib|aws_cdk|@aws-cdk/", "--", "*.ts", "*.py"],
      {
        cwd: repo,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 64 * 1024 * 1024,
      },
    )
      .split("\n")
      .filter((f) => f && !TEST.test(f) && !f.endsWith(".d.ts"));
  } catch {
    return [];
  }
}

/** The text of a call's arguments: from the open bracket at `at` to its match. */
function callArgs(text: string, at: number): string {
  let depth = 0;
  for (let i = at; i < text.length; i++) {
    const c = text[i];
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") {
      depth--;
      if (depth === 0) return text.slice(at, i + 1);
    }
  }
  return text.slice(at);
}

const lineAt = (text: string, i: number) => text.slice(0, i).split("\n").length;

/** The name at the end of an ARN or a name: "arn:aws:sqs:…:MyQueue" → "MyQueue". */
const lastName = (s: string) => s.split(/[:/]/).filter(Boolean).at(-1) ?? s;

type Var = { key: string };
type FileRead = {
  file: string;
  /** Classes in the file, by name: their fields set to resources. */
  classes: Map<string, Map<string, string>>;
  /** Where each class starts, to tell which class a line is in. */
  classAt: { name: string; at: number }[];
  /** Local variables and fields to resource keys, by class (or "" for the file). */
  vars: Map<string, Map<string, Var>>;
  /** Expressions to resolve later: `props.x` or a Python argument `x`, by class. */
  pending: { cls: string; expr: string; resolve: (key: string) => void }[];
};

/**
 * Resources and uses in one repo's CDK source. `stacksOf` maps a class name
 * to the stack construct IDs the app file creates it as.
 */
export function awsIn(folder: string, dir: string): { resources: AwsResource[]; uses: AwsUse[] } {
  const repo = path.join(folder, dir);
  const resources = new Map<string, AwsResource>();
  const uses: AwsUse[] = [];
  const reads: FileRead[] = [];
  const rel = (f: string) => path.posix.join(dir, f);
  /** The classes each resource is created in. */
  const madeIn = new Map<string, Set<string>>();
  /** Inside which classes each class is used: created there, or extended by it. */
  const usedIn = new Map<string, Set<string>>();
  const note = (m: Map<string, Set<string>>, k: string, v: string) => {
    let set = m.get(k);
    if (!set) m.set(k, (set = new Set()));
    set.add(v);
  };

  const add = (r: Omit<AwsResource, "stacks">): string => {
    const existing = resources.get(r.key);
    if (existing) {
      // Created somewhere beats imported anywhere.
      if (r.created && !existing.created) resources.set(r.key, { ...r, stacks: existing.stacks });
      return r.key;
    }
    resources.set(r.key, { ...r, stacks: [] });
    return r.key;
  };

  for (const f of files(repo)) {
    let text: string;
    try {
      text = readFileSync(path.join(repo, f), "utf8");
    } catch {
      continue;
    }
    const py = f.endsWith(".py");
    const read: FileRead = {
      file: f,
      classes: new Map(),
      classAt: [],
      vars: new Map(),
      pending: [],
    };
    for (const m of text.matchAll(
      py ? /^class\s+(\w+)\s*\(([^)]*)\)/gm : /\bclass\s+(\w+)\s+extends\s+([\w.]+)/g,
    )) {
      if (!m[1]) continue;
      // A subclass holds what its base class creates, whatever the base is called.
      for (const base of (m[2] ?? "").split(",")) {
        const b = base.trim().split(".").at(-1) ?? "";
        if (b && b !== m[1]) note(usedIn, b, m[1]);
      }
      if (/Stack|Construct/.test(m[2] ?? "")) {
        read.classAt.push({ name: m[1], at: m.index });
        read.classes.set(m[1], new Map());
      }
    }
    const classOf = (i: number) => read.classAt.filter((c) => c.at <= i).at(-1)?.name ?? "";
    const varsOf = (cls: string) => {
      let v = read.vars.get(cls);
      if (!v) {
        v = new Map<string, Var>();
        read.vars.set(cls, v);
      }
      return v;
    };
    /** The variable a value at `i` is assigned to: `const x =`, `this.x =`, `self.x =`, `x =`. */
    const assigned = (i: number): { name: string; field: boolean } | null => {
      const before = text.slice(Math.max(0, i - 120), i);
      const m =
        /(?:(?:const|let|var)\s+(\w+)|(this|self)\.(\w+)|^\s*(\w+))\s*(?::\s*[\w.<>[\]|]+\s*)?=\s*$/m.exec(
          before,
        );
      if (!m) return null;
      if (m[3]) return { name: m[3], field: true };
      return { name: m[1] ?? m[4] ?? "", field: false };
    };
    const remember = (i: number, key: string) => {
      const a = assigned(i);
      if (!a?.name) return;
      const cls = classOf(i);
      varsOf(cls).set(a.field ? `this.${a.name}` : a.name, { key });
      if (a.field) read.classes.get(cls)?.set(a.name, key);
    };

    // Created: new Table(this, "Id", { tableName: "X" }) / dynamodb.Table(self, "Id", table_name="X").
    const create = py
      ? new RegExp(
          String.raw`(?<![\w.])(?:[\w]+\.)?(${CONSTRUCTS})\(\s*self\s*,\s*f?["']([^"']+)["']`,
          "g",
        )
      : new RegExp(
          String.raw`\bnew\s+(?:[\w]+\.)?(${CONSTRUCTS})\s*\(\s*this\s*,\s*["'\x60]([^"'\x60]+)["'\x60]`,
          "g",
        );
    for (const m of text.matchAll(create)) {
      const kind = KIND[m[1] ?? ""];
      if (!kind) continue;
      const open = text.indexOf("(", m.index);
      const args = callArgs(text, open);
      const physical = NAME_PROP[kind].exec(args)?.[1] ?? null;
      const cls = classOf(m.index);
      const key = physical ? `${kind}:${physical}` : `${kind}:${dir}/${cls}/${m[2] ?? ""}`;
      if (cls) note(madeIn, key, cls);
      add({
        key,
        repo: dir,
        kind,
        name: physical ?? m[2] ?? "",
        physical,
        file: rel(f),
        line: lineAt(text, m.index),
        created: true,
      });
      remember(m.index, key);
      // A function's environment names what it uses: { USERS_TABLE: users.tableName }.
      if (kind === "function") {
        const env = /\benvironment\s*[:=]\s*(\{|dict\()/.exec(args);
        if (env) {
          const body = callArgs(args, env.index + env[0].length - 1);
          for (const e of body.matchAll(
            /[:=]\s*([\w.?]+?)\.(tableName|table_name|functionName|function_name|functionArn|function_arn|queueUrl|queue_url|queueArn|queue_arn|topicArn|topic_arn|bucketName|bucket_name)\b/g,
          ))
            read.pending.push({
              cls,
              expr: e[1] ?? "",
              resolve: (to) => {
                uses.push({
                  repo: dir,
                  file: rel(f),
                  line: lineAt(text, open),
                  from: key,
                  to,
                  action: "uses",
                });
              },
            });
        }
      }
    }

    // Imported by name: Table.fromTableName(this, "Id", "X") / Queue.from_queue_arn(self, "Id", "arn:…:X").
    const imp = py
      ? /(?<![\w.])(?:\w+\.)?(Table|TableV2|Function|Queue|Topic|Bucket)\.from_(\w+?)\(\s*self\s*,\s*f?["'][^"']*["']\s*,\s*(?:\w+\s*=\s*)?f?["']([^"'{}]+)["']/g
      : /(?<![\w.])(?:\w+\.)?(Table|TableV2|Function|Queue|Topic|Bucket)\.from(\w+?)\(\s*this\s*,\s*["'`][^"'`]*["'`]\s*,\s*["'`]([^"'`${}]+)["'`]/g;
    for (const m of text.matchAll(imp)) {
      const kind = KIND[m[1] ?? ""];
      if (!kind || !m[3]) continue;
      const name = lastName(m[3]);
      const key = `${kind}:${name}`;
      add({
        key,
        repo: dir,
        kind,
        name,
        physical: name,
        file: rel(f),
        line: lineAt(text, m.index),
        created: false,
      });
      remember(m.index, key);
    }

    // Grants: table.grantReadWriteData(fn) / table.grant_read_write_data(fn); fn.grantInvoke(caller).
    for (const m of text.matchAll(
      py
        ? /([\w.]+)\.grant_(read_write_data|read_data|write_data|invoke|send_messages|consume_messages|publish|read_write|read|write|put|stream_read|full_access)\(\s*([\w.]+)/g
        : /([\w.?]+)\.grant(ReadWriteData|ReadData|WriteData|Invoke|SendMessages|ConsumeMessages|Publish|ReadWrite|Read|Write|Put|StreamRead|FullAccess)\(\s*([\w.?]+)/g,
    )) {
      const action = GRANT[(m[2] ?? "").replace(/_/g, "").toLowerCase()];
      if (!action) continue;
      const cls = classOf(m.index);
      let subject: string | null = null;
      let grantee: string | null = null;
      const done = () => {
        if (!subject || !grantee) return;
        // fn.grantInvoke(caller): the caller invokes fn.
        const [from, to] = action === "invokes" ? [grantee, subject] : [grantee, subject];
        uses.push({ repo: dir, file: rel(f), line: lineAt(text, m.index), from, to, action });
      };
      read.pending.push({
        cls,
        expr: m[1] ?? "",
        resolve: (k) => {
          subject = k;
          done();
        },
      });
      read.pending.push({
        cls,
        expr: m[3] ?? "",
        resolve: (k) => {
          grantee = k;
          done();
        },
      });
    }

    // Event sources: fn.addEventSource(new SqsEventSource(queue)).
    for (const m of text.matchAll(
      py
        ? /([\w.]+)\.add_event_source\(\s*(?:[\w]+\.)?(?:Sqs|Dynamo|Sns|S3|Kinesis)EventSource\(\s*([\w.]+)/g
        : /([\w.?]+)\.addEventSource\(\s*new\s+(?:[\w]+\.)?(?:Sqs|Dynamo|Sns|S3|Kinesis)EventSource\(\s*([\w.?]+)/g,
    )) {
      const cls = classOf(m.index);
      let fn: string | null = null;
      let source: string | null = null;
      const done = () => {
        if (fn && source)
          uses.push({
            repo: dir,
            file: rel(f),
            line: lineAt(text, m.index),
            from: source,
            to: fn,
            action: "triggers",
          });
      };
      read.pending.push({
        cls,
        expr: m[1] ?? "",
        resolve: (k) => {
          fn = k;
          done();
        },
      });
      read.pending.push({
        cls,
        expr: m[2] ?? "",
        resolve: (k) => {
          source = k;
          done();
        },
      });
    }
    // A class created inside another, as a nested stack or a construct, is part of it.
    for (const m of text.matchAll(
      py
        ? /(?<![\w.])([A-Z]\w*)\(\s*[\w.]+\s*,\s*f?["']/g
        : /\bnew\s+(?:\w+\.)?([A-Z]\w*)\s*\(\s*[\w.]+\s*,\s*["'\x60]/g,
    )) {
      const parent = classOf(m.index);
      if (m[1] && parent && m[1] !== parent) note(usedIn, m[1], parent);
    }
    reads.push(read);
  }

  // The app file: which class each stack is, and what each stack's props are given.
  const instances = appWiring(repo);
  const classIndex = new Map<string, FileRead>();
  for (const r of reads) for (const c of r.classes.keys()) classIndex.set(c, r);
  // A resource is in every stack its class ends up in: created by the app
  // file as a stack, or used inside a class that is, through nested stacks,
  // constructs and subclasses.
  const stacksOf = (cls: string, seen = new Set<string>()): string[] => {
    if (seen.has(cls)) return [];
    seen.add(cls);
    const out = instances.filter((i) => i.cls === cls).map((i) => i.id);
    for (const outer of usedIn.get(cls) ?? []) out.push(...stacksOf(outer, seen));
    return out;
  };
  for (const [key, classes] of madeIn) {
    const res = resources.get(key);
    if (!res?.created) continue;
    for (const cls of classes)
      for (const id of stacksOf(cls)) if (!res.stacks.includes(id)) res.stacks.push(id);
  }

  const resolve = (r: FileRead, cls: string, expr: string): string[] => {
    const e = expr.replace(/\?/g, "").replace(/!$/, "");
    const v = r.vars.get(cls);
    const local = v?.get(e) ?? v?.get(e.replace(/^self\./, "this.")) ?? r.vars.get("")?.get(e);
    if (local) return [local.key];
    // props.x (TypeScript) or x / kwargs (Python): follow the app file.
    const prop =
      /^(?:props|this\.props|kwargs)\.(\w+)$/.exec(e)?.[1] ?? (/^\w+$/.test(e) ? e : null);
    if (!prop) return [];
    const out: string[] = [];
    for (const inst of instances.filter((i) => i.cls === cls)) {
      const given = inst.props.get(prop);
      if (!given) continue;
      const src = instances.find((i) => i.v === given.v);
      const key = src ? classIndex.get(src.cls)?.classes.get(src.cls)?.get(given.field) : undefined;
      if (key) out.push(key);
    }
    return [...new Set(out)];
  };
  for (const r of reads)
    for (const p of r.pending) for (const k of resolve(r, p.cls, p.expr)) p.resolve(k);

  // A use is about two different things; drop repeats.
  const seen = new Set<string>();
  const unique = uses.filter((u) => {
    const k = `${u.from}|${u.to}|${u.action}`;
    if (u.from === u.to || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { resources: [...resources.values()], uses: unique };
}

type Instance = {
  v: string;
  cls: string;
  id: string;
  props: Map<string, { v: string; field: string }>;
};

/** Stacks the CDK app creates: `const v = new C(app, "Id", { k: w.f })` or `v = C(app, "Id", k=w.f)`. */
export function appWiring(repo: string): Instance[] {
  let entry: string | undefined;
  try {
    const app = (JSON.parse(readFileSync(path.join(repo, "cdk.json"), "utf8")) as { app?: unknown })
      .app;
    entry = typeof app === "string" ? /([\w./-]+\.(?:ts|js|mjs|py))/.exec(app)?.[1] : undefined;
  } catch {
    return [];
  }
  if (!entry) return [];
  let text: string;
  try {
    text = readFileSync(path.join(repo, entry), "utf8");
  } catch {
    return [];
  }
  const out: Instance[] = [];
  // `const v = new C(app, "Id")`, or with no variable: `new C(app, "Id")`.
  for (const m of text.matchAll(
    /(?:(?:(?:const|let|var)\s+)?(\w+)\s*=\s*)?(?:new\s+)?(?<![\w.])([A-Z]\w*)\s*\(\s*\w+\s*,\s*f?["'`]([^"'`]+)["'`]/g,
  )) {
    if (!m[2] || !m[3]) continue;
    const args = callArgs(text, text.indexOf("(", m.index + m[0].indexOf(m[2])));
    const props = new Map<string, { v: string; field: string }>();
    for (const p of args.matchAll(/\b(\w+)\s*[:=]\s*(\w+)\.(\w+)\b(?!\s*\()/g))
      if (p[1] && p[2] && p[3]) props.set(p[1], { v: p[2], field: p[3] });
    out.push({ v: m[1] ?? "", cls: m[2], id: m[3], props });
  }
  return out;
}

export type AwsLink = {
  id: string;
  /** The function that acts, as a resource. */
  from: AwsResource;
  /** What it acts on: a resource created here, or one no repo here creates. */
  to: AwsResource;
  action: AwsAction;
  /** "found" from a construct call; "guessed" from a name that merely matches. */
  how: "found" | "guessed";
  evidence: string;
};

const SPECIFIC = new Set<AwsAction>([
  "invokes",
  "reads",
  "writes",
  "triggers",
  "sends",
  "publishes",
]);

/**
 * Every resource and link in the folder. A resource is joined across repos
 * by its physical name: the repo that creates it owns it, and a repo that
 * imports it by name links to that one. A name in one repo's source equal
 * to a function, table or queue another repo creates is a guessed link.
 */
export function awsLinks(
  folder: string,
  dirs: readonly string[],
): { resources: AwsResource[]; links: AwsLink[] } {
  const reads = dirs.map((d) => ({ dir: d, ...awsIn(folder, d) }));
  const owner = new Map<string, AwsResource>();
  for (const r of reads)
    for (const res of r.resources) if (res.created && !owner.has(res.key)) owner.set(res.key, res);
  const anyOf = new Map<string, AwsResource>();
  for (const r of reads)
    for (const res of r.resources) if (!anyOf.has(res.key)) anyOf.set(res.key, res);
  const links = new Map<string, AwsLink>();
  for (const r of reads) {
    // The specific action wins over a bare "uses" for the same pair.
    const specific = new Set(
      r.uses.filter((u) => SPECIFIC.has(u.action)).map((u) => `${u.from}|${u.to}`),
    );
    for (const u of r.uses) {
      if (u.action === "uses" && specific.has(`${u.from}|${u.to}`)) continue;
      const from = owner.get(u.from) ?? anyOf.get(u.from);
      const to = owner.get(u.to) ?? anyOf.get(u.to);
      if (!from || !to) continue;
      const id = `${from.key}|${to.key}|aws|${u.action}`;
      if (!links.has(id))
        links.set(id, {
          id,
          from,
          to,
          action: u.action,
          how: "found",
          evidence: `${u.file}:${String(u.line)}`,
        });
    }
  }
  // Names that merely match: a string in one repo equal to a resource another repo creates.
  const named = [...owner.values()].filter(
    (res) =>
      res.physical &&
      res.physical.length >= 6 &&
      /[A-Z]/.test(res.physical) &&
      /^[\w-]+$/.test(res.physical),
  );
  if (named.length)
    for (const d of dirs) {
      const theirs = named.filter((res) => res.repo !== d);
      if (!theirs.length) continue;
      const byName = new Map(theirs.map((res) => [res.physical ?? "", res]));
      let out: string;
      try {
        out = execFileSync(
          "git",
          [
            "grep",
            "-n",
            "-I",
            "-F",
            "-w",
            ...theirs.flatMap((res) => ["-e", `"${res.physical ?? ""}"`]),
            "--",
            "*.ts",
            "*.tsx",
            "*.js",
            "*.py",
          ],
          {
            cwd: path.join(folder, d),
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            maxBuffer: 64 * 1024 * 1024,
          },
        );
      } catch {
        continue; // No match exits 1.
      }
      for (const l of out.split("\n")) {
        const m = /^(.+?):(\d+):(.*)$/.exec(l);
        if (!m?.[1] || TEST.test(m[1])) continue;
        for (const q of (m[3] ?? "").matchAll(/"([\w-]+)"/g)) {
          const to = byName.get(q[1] ?? "");
          if (!to) continue;
          // Already joined by a construct call from this repo: nothing to guess.
          if ([...links.values()].some((x) => x.to.key === to.key && x.from.repo === d)) continue;
          const from: AwsResource = {
            key: `repo:${d}`,
            repo: d,
            kind: "function",
            name: d,
            physical: null,
            stacks: [],
            file: path.posix.join(d, m[1]),
            line: Number(m[2]),
            created: false,
          };
          const action: AwsAction =
            to.kind === "function" ? "invokes" : to.kind === "queue" ? "sends" : "uses";
          const id = `repo:${d}|${to.key}|aws|${action}`;
          if (!links.has(id))
            links.set(id, {
              id,
              from,
              to,
              action,
              how: "guessed",
              evidence: `${path.posix.join(d, m[1])}:${m[2] ?? ""}`,
            });
        }
      }
    }
  return {
    resources: [...owner.values()],
    links: [...links.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}
