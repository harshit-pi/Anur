import { anur } from "./bridge.ts";

/** A step of launch this window reached, timed in Anur's log (main/startup-marks.ts). */
export function startupMark(name: string): void {
  void anur.call("app:startup-mark", { name }).catch(() => undefined);
}
