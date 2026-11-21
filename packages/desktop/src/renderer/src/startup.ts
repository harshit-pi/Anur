import { anur } from "./bridge.ts";

/** A step of launch this window reached, timed in Anur's log (main/startup-marks.ts). */
export function startupMark(name: string): void {
  void anur.call("app:startup-mark", { name }).catch(() => undefined);
}

/**
 * Frames held up over 200 ms in this window's first minutes, with the script
 * that held them when Chromium says, in Anur's log.
 */
export function watchLongTasks(): void {
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.duration < 200 || e.startTime > 180_000) continue;
        type Script = { sourceFunctionName?: string; invoker?: string; sourceURL?: string };
        const first = (e as PerformanceEntry & { scripts?: Script[] }).scripts?.[0];
        const file = first?.sourceURL?.split("/").pop() ?? "";
        const by = [first?.sourceFunctionName || first?.invoker, file].filter(Boolean).join(" in ");
        startupMark(
          `held up ${String(Math.round(e.duration))} ms at ${String(Math.round(e.startTime))} ms${by ? ` by ${by.slice(0, 40)}` : ""}`,
        );
      }
    }).observe({ type: "long-animation-frame", buffered: true });
  } catch {
    // No frame timing here: nothing to watch.
  }
}
