/**
 * Claude's own choices at task end (21.3; Design §2): the prompt hook asks
 * for them in one line of context, and the Stop hook reads them back from
 * the transcript's last reply. Nothing is inferred: no "Choices:" list, no
 * choices.
 */
import { readFileSync } from "node:fs";

/** Starts Anur's own questions to the agent, such as naming groups: never a task to report. */
export const INTERNAL_MARK = "[anur:internal]";

/** Added to each prompt in an opened folder, so the reply ends with its choices. */
export const CHOICES_ASK =
  'Anur: when you finish this task, if you made choices nobody asked for (a value, a default, a behaviour, a library), end your reply with a line "Choices:" and one short "- " bullet per choice. Leave it out when there were none.';

/** The text of the transcript's last assistant reply. */
export function lastReply(transcriptPath: string): string {
  let text: string;
  try {
    text = readFileSync(transcriptPath, "utf8");
  } catch {
    return "";
  }
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line?.includes('"assistant"')) continue;
    try {
      const e = JSON.parse(line) as {
        type?: string;
        message?: { role?: string; content?: unknown };
      };
      if (e.type !== "assistant" || e.message?.role !== "assistant") continue;
      const c = e.message.content;
      const parts = Array.isArray(c)
        ? c.flatMap((x) =>
            x &&
            typeof x === "object" &&
            (x as { type?: string }).type === "text" &&
            typeof (x as { text?: unknown }).text === "string"
              ? [(x as { text: string }).text]
              : [],
          )
        : typeof c === "string"
          ? [c]
          : [];
      if (parts.join("").trim()) return parts.join("\n");
    } catch {
      // A torn line: skipped.
    }
  }
  return "";
}

/** The "Choices:" list at the end of a reply, each bullet trimmed. */
export function choicesIn(reply: string): string[] {
  const lines = reply.split("\n");
  const at = lines.findLastIndex((l) =>
    /^\s*(#+\s*)?(\*\*)?\s*(Claude's )?choices( I made)?\s*:?\s*(\*\*)?\s*:?\s*$/i.test(l),
  );
  if (at < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(at + 1)) {
    const m = /^\s*[-*•]\s+(.+?)\s*$/.exec(l);
    if (m?.[1]) out.push(m[1].replace(/\*\*/g, "").slice(0, 200));
    else if (l.trim() && out.length) break;
  }
  return out.slice(0, 12);
}
