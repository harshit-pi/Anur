import type { OpenWindow } from "./open-windows.ts";

/**
 * Remembering the open windows once per quit. A quit remembers them as it
 * starts; a restart to update closes every window before the quit starts, so
 * it remembers them first, and the quit then keeps that rather than none.
 */
export function windowMemory(save: (open: OpenWindow[]) => Promise<void>) {
  let remembered = false;
  return {
    /** Before a restart that closes the windows itself: remember them now. */
    async beforeRestart(open: OpenWindow[]): Promise<void> {
      remembered = true;
      await save(open);
    },
    /** As a quit starts: remember the windows, unless this quit already did. */
    atQuit(open: OpenWindow[]): Promise<void> | null {
      return remembered ? null : save(open);
    },
  };
}
