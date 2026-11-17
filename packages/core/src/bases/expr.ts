/**
 * The expression language of an Obsidian base's filters and formulas, read
 * into a tree: `note.status != "killed"`, `file.inFolder("Ideas")`,
 * `note.score_r2 - note.score_r1`. Evaluating it is values.ts.
 */

export type Expr =
  | { kind: "literal"; value: string | number | boolean | null }
  | { kind: "name"; name: string }
  | { kind: "member"; object: Expr; name: string }
  | { kind: "index"; object: Expr; index: Expr }
  | { kind: "call"; callee: Expr; args: Expr[] }
  | { kind: "unary"; op: "!" | "-"; arg: Expr }
  | { kind: "binary"; op: string; left: Expr; right: Expr };

type Token =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "id"; v: string }
  | { t: "op"; v: string };

const OPS = [
  "==",
  "!=",
  ">=",
  "<=",
  "&&",
  "||",
  ">",
  "<",
  "!",
  "+",
  "-",
  "*",
  "/",
  "%",
  "(",
  ")",
  "[",
  "]",
  ",",
  ".",
];

function tokens(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src.charAt(i);
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9]/.test(c)) {
      const m = /^[0-9]+(\.[0-9]+)?/.exec(src.slice(i))?.[0] ?? c;
      out.push({ t: "num", v: Number(m) });
      i += m.length;
    } else if (c === '"' || c === "'") {
      let s = "";
      i++;
      while (i < src.length && src.charAt(i) !== c) {
        if (src.charAt(i) === "\\") i++;
        s += src.charAt(i);
        i++;
      }
      if (i >= src.length) throw new Error("a quote is never closed");
      i++;
      out.push({ t: "str", v: s });
    } else if (/[\p{L}_$]/u.test(c)) {
      const m = /^[\p{L}\p{N}_$]+/u.exec(src.slice(i))?.[0] ?? c;
      out.push({ t: "id", v: m });
      i += m.length;
    } else {
      const op = OPS.find((o) => src.startsWith(o, i));
      if (!op) throw new Error(`"${c}" isn't understood`);
      out.push({ t: "op", v: op });
      i += op.length;
    }
  }
  return out;
}

const LEVELS = [["||"], ["&&"], ["==", "!="], [">", "<", ">=", "<="], ["+", "-"], ["*", "/", "%"]];

/** Read an expression; throws, saying what isn't understood. */
export function parseExpr(src: string): Expr {
  const ts = tokens(src);
  let at = 0;
  const peek = () => ts[at];
  const isOp = (v: string) => {
    const t = peek();
    return t?.t === "op" && t.v === v;
  };
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(`expected "${v}"`);
    at++;
  };

  const binary = (level: number): Expr => {
    const ops = LEVELS[level];
    if (!ops) return unary();
    let left = binary(level + 1);
    for (let t = peek(); t?.t === "op" && ops.includes(t.v); t = peek()) {
      at++;
      left = { kind: "binary", op: t.v, left, right: binary(level + 1) };
    }
    return left;
  };
  const unary = (): Expr => {
    if (isOp("!") || isOp("-")) {
      const op = (peek() as { v: "!" | "-" }).v;
      at++;
      return { kind: "unary", op, arg: unary() };
    }
    return postfix();
  };
  const args = (): Expr[] => {
    const list: Expr[] = [];
    expect("(");
    while (!isOp(")")) {
      list.push(binary(0));
      if (!isOp(")")) expect(",");
    }
    expect(")");
    return list;
  };
  const postfix = (): Expr => {
    let e = primary();
    for (;;) {
      if (isOp(".")) {
        at++;
        const t = peek();
        if (t?.t !== "id") throw new Error('expected a name after "."');
        at++;
        e = { kind: "member", object: e, name: t.v };
      } else if (isOp("[")) {
        at++;
        const index = binary(0);
        expect("]");
        e = { kind: "index", object: e, index };
      } else if (isOp("(")) {
        e = { kind: "call", callee: e, args: args() };
      } else return e;
    }
  };
  const primary = (): Expr => {
    const t = peek();
    if (!t) throw new Error("it ends too soon");
    at++;
    if (t.t === "num" || t.t === "str") return { kind: "literal", value: t.v };
    if (t.t === "id") {
      if (t.v === "true" || t.v === "false") return { kind: "literal", value: t.v === "true" };
      if (t.v === "null") return { kind: "literal", value: null };
      return { kind: "name", name: t.v };
    }
    if (t.v === "(") {
      const e = binary(0);
      expect(")");
      return e;
    }
    throw new Error(`"${t.v}" isn't understood here`);
  };

  const e = binary(0);
  if (at < ts.length) throw new Error("there is more after the expression");
  return e;
}
