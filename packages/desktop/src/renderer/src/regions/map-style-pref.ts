import { useEffect, useState } from "react";

/**
 * How the map draws (Settings → Appearance): clean lines, or hand-drawn as
 * Excalidraw draws. Kept on this Mac; every open window follows a change.
 */
export type MapStyle = "clean" | "hand";

const KEY = "anur.mapStyle";
const CHANGED = "anur:map-style";

export function loadMapStyle(storage: Pick<Storage, "getItem">): MapStyle {
  try {
    return storage.getItem(KEY) === "hand" ? "hand" : "clean";
  } catch {
    return "clean";
  }
}

export function saveMapStyle(storage: Pick<Storage, "setItem">, style: MapStyle) {
  try {
    storage.setItem(KEY, style);
  } catch {
    // Storage blocked: the style holds until Anur restarts.
  }
  window.dispatchEvent(new CustomEvent(CHANGED));
}

/** The map style now, following changes made here or in another window. */
export function useMapStyle(): MapStyle {
  const [style, setStyle] = useState<MapStyle>(() => loadMapStyle(window.localStorage));
  useEffect(() => {
    const read = () => {
      setStyle(loadMapStyle(window.localStorage));
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
  return style;
}
