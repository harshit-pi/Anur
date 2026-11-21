import type { AnurBridge } from "../../shared/ipc-contract.ts";

declare global {
  interface Window {
    anur: AnurBridge;
  }
}

/**
 * The page's only way out: checked channels, through the preload. Read from
 * `window` on first use, so a module importing it still loads outside a browser.
 */
export const anur: AnurBridge = new Proxy({} as AnurBridge, {
  get: (_, key) => {
    const v: unknown = Reflect.get(window.anur, key);
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(window.anur) : v;
  },
});
