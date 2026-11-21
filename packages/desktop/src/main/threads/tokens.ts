/**
 * A thread's token use, from its lines.
 */
import { type KnownThreadLine } from "@anur/core";

export const KNOWN = new Set([
  "thread",
  "session",
  "turn",
  "message",
  "tool",
  "state",
  "options",
  "option-used",
  "option-explored",
  "option-skipped",
  "input",
  "input-removed",
  "added-input",
  "auto-used",
  "auto-undone",
  "renamed",
  "check",
  "created",
  "page-gone",
  "page-back",
  "proposed",
  "used-all",
  "finding",
  "finding-decided",
  "action-proposed",
  "action-run",
]);

/**
 * A thread's tokens from its turns' usage reports (4.10): everything it has
 * used, and its context on the last reported turn, which the next turn
 * starts from.
 */
export function tokensOf(lines: readonly KnownThreadLine[]) {
  let used = 0;
  let cached = 0;
  let context = 0;
  let first: number | null = null;
  let window: number | null = null;
  let any = false;
  for (const l of lines) {
    if (l.kind !== "turn" || l.event !== "end" || !l.usage) continue;
    const u = l.usage;
    any = true;
    used += u.input + u.output + u.cacheRead + u.cacheWrite;
    cached += u.cacheRead;
    // The agent's own measure of its context when it gave one; else the usage report's.
    context = l.context?.used ?? u.input + u.cacheRead + u.cacheWrite + u.output;
    first ??= context;
    if (l.context) window = l.context.size;
  }
  return any ? { used, cached, context, first: first ?? context, window } : null;
}
