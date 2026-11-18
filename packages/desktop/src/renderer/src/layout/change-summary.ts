/**
 * What an edit changes, in a few words, for its card on the map (17.2):
 * "£5 → £2.99", "+ a new line", "− a cut line". Words the two share at the
 * start and end are left out, so the card shows the change, not the text.
 */
export function changeSummary(before: string, after: string, max = 24): string {
  const a = before.trim().split(/(\s+)/);
  const b = after.trim().split(/(\s+)/);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end++;
  const flat = (s: string) => s.replace(/\s+/g, " ").trim();
  const cut = (s: string) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
  const was = flat(a.slice(start, a.length - end).join(""));
  const now = flat(b.slice(start, b.length - end).join(""));
  if (!was && !now) return "No change";
  if (!was) return `+ ${cut(now)}`;
  if (!now) return `− ${cut(was)}`;
  return `${cut(was)} → ${cut(now)}`;
}
