/**
 * What Think keeps on this Mac across a restart: the thread open on each doc,
 * and what was typed and not yet sent, so an update's restart loses neither.
 */
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const OPEN = "anur.open-thread:";
const DRAFT = "anur.draft:";

const read = (s: Store, key: string): string | null => {
  try {
    return s.getItem(key);
  } catch {
    return null;
  }
};
const write = (s: Store, key: string, value: string | null) => {
  try {
    if (value) s.setItem(key, value);
    else s.removeItem(key);
  } catch {
    // Storage full or blocked: it's only a convenience.
  }
};

export const loadOpenThread = (s: Store, doc: string) => read(s, OPEN + doc);
export const saveOpenThread = (s: Store, doc: string, thread: string | null) => {
  write(s, OPEN + doc, thread);
};

export const loadDraft = (s: Store, key: string) => read(s, DRAFT + key) ?? "";
/** Blank text clears it: a sent message leaves no draft behind. */
export const saveDraft = (s: Store, key: string, text: string) => {
  write(s, DRAFT + key, text.trim() ? text : null);
};

/** Whether anything typed is waiting unsent, in any composer this window has. */
export function anyDraft(s: Pick<Storage, "length" | "key" | "getItem">): boolean {
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k?.startsWith(DRAFT) && s.getItem(k)?.trim()) return true;
    }
  } catch {
    return true;
  }
  return false;
}
