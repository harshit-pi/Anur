import { useEffect, useState } from "react";
import { DEFAULT_FLAGS, type FeatureFlags } from "../../shared/features.ts";
import { anur } from "./bridge.ts";

/**
 * The switchable Core features as the page sees them (group 12): read once,
 * then kept current when Settings, in this window or another, flips one.
 * Everything is on until main says otherwise.
 */
let current: FeatureFlags = { ...DEFAULT_FLAGS };
const listeners = new Set<(f: FeatureFlags) => void>();
let started = false;

function start() {
  if (started) return;
  started = true;
  const set = (f: FeatureFlags) => {
    current = f;
    for (const l of listeners) l(f);
  };
  void anur.call("features:get", {}).then(set);
  anur.on("features:changed", set);
}

export function useFeatures(): FeatureFlags {
  const [flags, setFlags] = useState(current);
  useEffect(() => {
    start();
    listeners.add(setFlags);
    setFlags(current);
    return () => {
      listeners.delete(setFlags);
    };
  }, []);
  return flags;
}

/** The flags right now, for code outside React such as the tour's steps. */
export const featuresNow = () => current;
