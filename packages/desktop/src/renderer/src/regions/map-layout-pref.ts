import { useCallback, useState } from "react";

/**
 * How the map lays out a doc: a mind map (the title in the middle, sections
 * to both sides; mock 8) or a tree read top down. Kept on this Mac.
 */
export type MapLayout = "mind" | "tree";

const KEY = "anur.map.layout";

export function loadMapLayout(storage: Pick<Storage, "getItem">): MapLayout {
  try {
    return storage.getItem(KEY) === "tree" ? "tree" : "mind";
  } catch {
    return "mind";
  }
}

export function useMapLayout(): [MapLayout, (next: MapLayout) => void] {
  const [layout, setLayout] = useState(() => loadMapLayout(window.localStorage));
  const set = useCallback((next: MapLayout) => {
    setLayout(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // Storage blocked: the layout holds until Anur restarts.
    }
  }, []);
  return [layout, set];
}
