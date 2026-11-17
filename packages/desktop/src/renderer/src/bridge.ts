import type { AnurBridge } from "../../shared/ipc-contract.ts";

declare global {
  interface Window {
    anur: AnurBridge;
  }
}

/** The page's only way out: checked channels, through the preload. */
export const anur: AnurBridge = window.anur;
