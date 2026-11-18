/**
 * The page's font, picked in Settings → Appearance: a serif close to Claude's
 * (the default), the app's sans, or the Mac's own. <html> carries data-page-font.
 */
export type PageFont = "serif" | "sans" | "system";

const KEY = "anur.pageFont";

export function loadPageFont(storage: Pick<Storage, "getItem">): PageFont {
  try {
    const v = storage.getItem(KEY);
    return v === "sans" || v === "system" ? v : "serif";
  } catch {
    return "serif";
  }
}

export function applyPageFont(font: PageFont, root: HTMLElement = document.documentElement) {
  root.dataset.pageFont = font;
}

export function savePageFont(storage: Pick<Storage, "setItem">, font: PageFont) {
  try {
    storage.setItem(KEY, font);
  } catch {
    // Storage blocked: the font holds until Anur restarts.
  }
}

/** Another window picked a font: this one follows. */
export function followPageFont(): () => void {
  const on = (e: StorageEvent) => {
    if (e.key === KEY) applyPageFont(loadPageFont(window.localStorage));
  };
  window.addEventListener("storage", on);
  return () => {
    window.removeEventListener("storage", on);
  };
}
