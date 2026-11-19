/**
 * Whether a decision's "until" has passed (18.2). Only a date can be read
 * without a model: "2026-12-01", "Dec 1", "1 December 2026", "December 1,
 * 2026". Anything else, such as "for now" or "until launch", never lapses
 * by itself and stays shown with the decision.
 */

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const;

const month = (word: string): number => MONTHS.indexOf(word.slice(0, 3).toLowerCase() as never);

/**
 * The last day an "until" names, as a UTC date, or null when it names no
 * date. A date with no year is the next one on or after the day it was kept.
 */
export function untilDate(until: string, keptAt: string): Date | null {
  const t = until.toLowerCase();
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
  if (iso) return day(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const name = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
  const md = new RegExp(`\\b${name}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`).exec(t);
  const dm = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+${name}(?:,?\\s+(\\d{4}))?\\b`,
  ).exec(t);
  const parts = md
    ? { m: month(md[1] ?? ""), d: Number(md[2]), y: md[3] }
    : dm
      ? { m: month(dm[2] ?? ""), d: Number(dm[1]), y: dm[3] }
      : null;
  if (!parts || parts.m < 0) return null;
  if (parts.y) return day(Number(parts.y), parts.m, parts.d);
  const kept = new Date(keptAt);
  if (Number.isNaN(kept.getTime())) return null;
  const same = day(kept.getUTCFullYear(), parts.m, parts.d);
  if (!same) return null;
  return same.getTime() >= Date.UTC(kept.getUTCFullYear(), kept.getUTCMonth(), kept.getUTCDate())
    ? same
    : day(kept.getUTCFullYear() + 1, parts.m, parts.d);
}

function day(y: number, m: number, d: number): Date | null {
  const date = new Date(Date.UTC(y, m, d));
  return date.getUTCMonth() === m && date.getUTCDate() === d ? date : null;
}

/** Whether the "until" named a day that is over by `now`. */
export function untilPassed(until: string | null, keptAt: string, now: Date = new Date()): boolean {
  if (!until) return false;
  const last = untilDate(until, keptAt);
  return last !== null && now.getTime() >= last.getTime() + 24 * 3600_000;
}
