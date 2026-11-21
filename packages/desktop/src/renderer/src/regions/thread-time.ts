/**
 * When something in a thread happened, in a few words.
 */

/** "Just now", "5 min ago", then the time today, else the date. */
export function sentWhen(at: string): string {
  const d = new Date(at);
  const ms = Date.now() - d.getTime();
  if (ms < 60_000) return "Just now";
  if (ms < 3_600_000) return `${String(Math.round(ms / 60_000))} min ago`;
  if (d.toDateString() === new Date().toDateString())
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** "4m", "2h", "Yesterday", "14 Nov": short, for a thread card. */
export function ago(at: string): string {
  const ms = Date.now() - new Date(at).getTime();
  if (ms < 60_000) return "now";
  if (ms < 3_600_000) return `${String(Math.round(ms / 60_000))}m`;
  if (ms < 86_400_000) return `${String(Math.round(ms / 3_600_000))}h`;
  if (ms < 2 * 86_400_000) return "Yesterday";
  return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** "3 min ago", "2 h ago", "14 Nov". */
export function when(at: string): string {
  const ms = Date.now() - new Date(at).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${String(Math.round(ms / 60_000))} min ago`;
  if (ms < 86_400_000) return `${String(Math.round(ms / 3_600_000))} h ago`;
  return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
