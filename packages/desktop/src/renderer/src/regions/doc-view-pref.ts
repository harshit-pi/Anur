import { useEffect, useState } from "react";

/**
 * Which view a doc opens in the first time (Settings → General): the map, by
 * default, or the page. After that each doc reopens as it was left.
 */
export type DocView = "map" | "page";

const KEY = "anur.docView";
const CHANGED = "anur:doc-view";

export function loadDocView(storage: Pick<Storage, "getItem">): DocView {
  try {
    return storage.getItem(KEY) === "page" ? "page" : "map";
  } catch {
    return "map";
  }
}

export function saveDocView(storage: Pick<Storage, "setItem">, view: DocView) {
  try {
    storage.setItem(KEY, view);
  } catch {
    // Storage blocked: the choice holds until Anur restarts.
  }
  window.dispatchEvent(new CustomEvent(CHANGED));
}

/** The choice now, following changes made here or in another window. */
export function useDocView(): DocView {
  const [view, setView] = useState<DocView>(() => loadDocView(window.localStorage));
  useEffect(() => {
    const read = () => {
      setView(loadDocView(window.localStorage));
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) read();
    };
    window.addEventListener(CHANGED, read);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CHANGED, read);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return view;
}
