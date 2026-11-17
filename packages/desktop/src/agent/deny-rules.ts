import path from "node:path";

/**
 * The person's own deny rules, carried onto working copies (task 3.3;
 * Context, "The working copy"). Claude Code checks a rule such as
 * `Read(./private/**)` against the path a tool names, and a working copy
 * lives at another path, so the hook checks each copy against the rules as
 * if it were the doc it copies.
 *
 * Paths follow Claude Code's permission rules: `//abs` is absolute, `~/` is
 * the home folder, `/x` is relative to the settings file's project, and
 * `x` or `./x` relative to the working folder; patterns are gitignore-style.
 */

export type DenyRule = {
  /** "read" for Read rules; "edit" for Edit and Write rules, which cover every edit tool. */
  kind: "read" | "edit";
  /** The rule as written, for the refusal message. */
  rule: string;
  /** An absolute path pattern. */
  pattern: string;
};

/** A settings file's deny rules; `project` is the folder `/x` is relative to. */
export function denyRulesOf(
  settings: unknown,
  opts: { project: string; cwd: string; home: string },
): DenyRule[] {
  const deny = (settings as { permissions?: { deny?: unknown } } | null)?.permissions?.deny;
  if (!Array.isArray(deny)) return [];
  return deny.flatMap((raw): DenyRule[] => {
    if (typeof raw !== "string") return [];
    const m = /^(Read|Edit|Write|MultiEdit)\((.+)\)$/.exec(raw.trim());
    if (!m?.[1] || !m[2]) return [];
    const p = m[2].trim();
    const abs = p.startsWith("//")
      ? p.slice(1)
      : p.startsWith("~/")
        ? path.join(opts.home, p.slice(2))
        : p.startsWith("/")
          ? path.join(opts.project, p.slice(1))
          : path.join(opts.cwd, p.replace(/^\.\//, ""));
    return [{ kind: m[1] === "Read" ? "read" : "edit", rule: raw.trim(), pattern: abs }];
  });
}

/** A gitignore-style pattern as a regular expression: `**` any depth, `*` and `?` within a name. */
export function patternRegExp(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] ?? "";
    if (c === "*" && pattern[i + 1] === "*") {
      // "**/" matches no folder or several; a trailing "**" matches everything below.
      if (pattern[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  // A folder pattern covers what is inside it, as in gitignore.
  return new RegExp(`^${re}(?:/.*)?$`, "i");
}

/** The rule that denies `kind` on the doc at `docAbs`, or null. */
export function denies(
  rules: readonly DenyRule[],
  kind: "read" | "edit",
  docAbs: string,
): DenyRule | null {
  return rules.find((r) => r.kind === kind && patternRegExp(r.pattern).test(docAbs)) ?? null;
}
