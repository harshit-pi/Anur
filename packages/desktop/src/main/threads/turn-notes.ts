/**
 * What a turn tells the agent about its own work: the actions it proposed, the steps it took, and how its edits landed.
 */
import { ThreadLine } from "@anur/core";
import type { ThreadItem } from "../../shared/ipc-contract.ts";

/** The web addresses in what a person wrote, without trailing punctuation. */
export function linksIn(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>()"'`]+/gi) ?? [];
  return [...new Set(found.map((u) => u.replace(/[.,;:!?)\]]+$/, "")))];
}

/**
 * A Build or Check as its map box shows it (Mock 10): running, waiting on the
 * person, or how its last turn ended, with a few words on what it did.
 */
export function actionOf(
  lines: readonly ThreadLine[],
  busy: boolean,
  ask: { request: string; option: string } | undefined,
  items: readonly ThreadItem[],
): {
  state: "running" | "needs" | "done" | "failed" | "stopped";
  detail: string;
  ask: { request: string; option: string } | null;
} {
  const tools = items.filter((i): i is Extract<ThreadItem, { kind: "tool" }> => i.kind === "tool");
  const made = items.filter((i) => i.kind === "created" && !i.undone).length;
  const services = tools.filter(
    (t) => /^mcp__(?!anur__)/.test(t.title) && t.status === "completed",
  ).length;
  const did = [
    made ? `${String(made)} doc${made === 1 ? "" : "s"}` : "",
    services ? `${String(services)} in services` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  if (ask) return { state: "needs", detail: "Plan waiting", ask };
  if (busy) {
    const step = tools.at(-1);
    return {
      state: "running",
      detail: step && !/^(completed|failed)$/.test(step.status) ? stepName(step.title) : "Working…",
      ask: null,
    };
  }
  const end = [...lines].reverse().find((l) => l.kind === "turn" && l.event === "end");
  const reason = (end as { stopReason?: unknown } | undefined)?.stopReason;
  const why = typeof reason === "string" ? reason : "";
  if (why === "cancelled")
    return { state: "stopped", detail: `At step ${String(tools.length)}`, ask: null };
  if (why.startsWith("error:"))
    return { state: "failed", detail: why.slice(6).trim().slice(0, 40) || "It failed", ask: null };
  // A choice it ends on is no warning (30.33): its options already hang off it on the
  // map, and one picked while exploring them lives in another thread, so "!" would stay.
  // It ended saying it couldn't do the work: a ✓ would claim what isn't there.
  const last = [...items].reverse().find((i) => i.kind === "message" && i.role === "agent");
  if (last?.kind === "message" && COULD_NOT.test(last.text))
    return { state: "needs", detail: "Didn't finish", ask: null };
  return { state: "done", detail: did || `${String(tools.length)} steps`, ask: null };
}

/** An agent's closing reply that opens by saying the work wasn't done ("I couldn't build the funnel…"). */
export const COULD_NOT =
  /^\W*(?:I\s+)?(?:couldn['’]t|could not|can['’]t|cannot|wasn['’]t able|was unable|haven['’]t|have not|didn['’]t|did not)\b/i;

/** A step as a person reads it on a box: "PostHog: exec", not "mcp__claude_ai_PostHog__exec". */
export function stepName(title: string): string {
  // Anur's own tools read as what they did.
  const own = /^mcp__anur__anur_(\w+)/.exec(title)?.[1];
  if (own) {
    const words = own.replace(/_/g, " ");
    return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
  }
  const m = /^mcp__(?:claude_ai_)?([A-Za-z0-9-]+?)__([A-Za-z0-9_-]+)/.exec(title);
  if (m)
    return `${(m[1] ?? "").replace(/_/g, " ")}: ${(m[2] ?? "").replace(/_/g, " ")}`.slice(0, 40);
  // A tool's own title reads as a step ("Read Plan.md"); a shell command is
  // just its text, which means nothing on a map pill.
  if (/^[A-Z][a-z]+(?:\s|$)/.test(title)) return title.slice(0, 40);
  return "Running a command";
}

/**
 * What the agent is told about how its edits reach the doc, so its reply
 * matches what the person sees: in a mode that acts without asking they land
 * at once, so it never says one "is ready to use" (30.38).
 */
export function landingNote(lands: boolean): string {
  return lands
    ? "In the person's mode your edits land in the doc as you make them, and ⌘Z on the page takes one back. Say what you changed in the doc; never that an edit is ready for them to use."
    : "In the person's mode your edits wait as proposals on their sections, and the doc changes only when the person uses one. Say your edit is ready for them to use; never that you've updated the doc.";
}
