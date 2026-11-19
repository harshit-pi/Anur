import type { SessionOption } from "./ipc-contract.ts";

/**
 * Whether an agent's edits change the doc as they land, or wait as
 * proposals: the thread's mode decides. A mode that acts without asking
 * (auto, accept edits, bypass) lands them, each noted with Undo; the
 * default, which asks, and plan mode keep them as proposals. Options are
 * always the person's to pick, whatever the mode.
 */
const LANDS = new Set(["auto", "acceptEdits", "bypassPermissions", "dontAsk"]);

export function editsLand(options: readonly SessionOption[] | undefined): boolean {
  const mode = options?.find((o) => o.choices.some((c) => c.value === "plan"));
  return !!mode && LANDS.has(mode.current);
}
