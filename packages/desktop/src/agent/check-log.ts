import { readFile } from "node:fs/promises";

/**
 * Reading the hook's log, for the thread check (3.2): the session's start
 * hook checked in, and every completed tool call passed through the hook.
 */

type Entry = { session?: string | null; event?: string; toolUse?: string | null };

async function entries(log: string): Promise<Entry[]> {
  const text = await readFile(log, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as Entry];
      } catch {
        return [];
      }
    });
}

/** Wait for the session's start hook to check in; false after `ms`. */
export async function checkedIn(log: string, session: string, ms = 8000): Promise<boolean> {
  const until = Date.now() + ms;
  for (;;) {
    if ((await entries(log)).some((e) => e.event === "start" && e.session === session)) return true;
    if (Date.now() > until) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Whether the hook saw this tool call before it ran. */
export async function hookSaw(log: string, toolUse: string): Promise<boolean> {
  return (await entries(log)).some((e) => e.event === "tool" && e.toolUse === toolUse);
}
