/**
 * The app's theme (2.25): the system's, or always light or dark. The colour
 * tokens follow the system unless <html> carries data-theme.
 */
export type ThemePref = "system" | "light" | "dark";

const KEY = "anur.theme";

export function loadTheme(storage: Pick<Storage, "getItem">): ThemePref {
  try {
    const v = storage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(pref: ThemePref, root: HTMLElement = document.documentElement) {
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;
}

export function saveTheme(storage: Pick<Storage, "setItem">, pref: ThemePref) {
  try {
    storage.setItem(KEY, pref);
  } catch {
    // Storage blocked: the theme holds until Anur restarts.
  }
}
