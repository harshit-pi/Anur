/**
 * How a thread event changes what the renderer holds of its items.
 */
import type { EventPayload, ThreadItem } from "../../../shared/ipc-contract.ts";

/** A reply arriving piece by piece, or a tool call changing state. */
export function withEvent(
  items: ThreadItem[],
  e: Exclude<EventPayload<"thread:event">, { kind: "thread" | "permission" }>,
): ThreadItem[] {
  if (e.kind === "text") {
    const last = items.at(-1);
    if (last?.kind === "message" && last.role === "agent" && last.turn === e.turn)
      return [...items.slice(0, -1), { ...last, text: last.text + e.text }];
    return [...items, { kind: "message", turn: e.turn, role: "agent", text: e.text }];
  }
  const at = items.findIndex((i) => i.kind === "tool" && i.toolUse === e.toolUse);
  const tool: ThreadItem = {
    kind: "tool",
    turn: e.turn,
    toolUse: e.toolUse,
    title: e.title,
    status: e.status,
  };
  return at < 0 ? [...items, tool] : items.map((i, n) => (n === at ? tool : i));
}
