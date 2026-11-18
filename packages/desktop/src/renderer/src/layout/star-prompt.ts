/**
 * When to ask for a star (the card at the bottom right): after Anur was used
 * on DAYS different days, once; "Not now" waits SNOOZE_DAYS, and a second
 * "Not now", a close or a star end it for good. Kept per Mac.
 */
export const DAYS = 5;
export const SNOOZE_DAYS = 30;
const KEY = "anur.starPrompt";

export type StarState = {
  /** The days Anur was used, as YYYY-MM-DD, up to DAYS of them. */
  days: string[];
  /** Done asking: starred, or declined twice. */
  done: boolean;
  /** Times "Not now" was picked. */
  snoozes: number;
  /** Not before this day, after a "Not now". */
  until: string | null;
};

const fresh = (): StarState => ({ days: [], done: false, snoozes: 0, until: null });

export function readStar(storage: Pick<Storage, "getItem">): StarState {
  try {
    const raw = JSON.parse(storage.getItem(KEY) ?? "null") as Partial<StarState> | null;
    if (!raw) return fresh();
    return {
      days: Array.isArray(raw.days) ? raw.days.filter((d) => typeof d === "string") : [],
      done: raw.done === true,
      snoozes: typeof raw.snoozes === "number" ? raw.snoozes : 0,
      until: typeof raw.until === "string" ? raw.until : null,
    };
  } catch {
    return fresh();
  }
}

export function writeStar(storage: Pick<Storage, "setItem">, s: StarState) {
  try {
    storage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage blocked: it asks again another day.
  }
}

export const dayOf = (d: Date) =>
  `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Today counted as a day of use. */
export function used(s: StarState, today: string): StarState {
  if (s.days.includes(today) || s.days.length >= DAYS) return s;
  return { ...s, days: [...s.days, today] };
}

export function shouldAsk(s: StarState, today: string): boolean {
  return !s.done && s.days.length >= DAYS && (s.until === null || today >= s.until);
}

export function snoozed(s: StarState, today: Date): StarState {
  const later = new Date(today);
  later.setDate(later.getDate() + SNOOZE_DAYS);
  return s.snoozes >= 1
    ? { ...s, done: true, snoozes: s.snoozes + 1 }
    : { ...s, snoozes: s.snoozes + 1, until: dayOf(later) };
}
