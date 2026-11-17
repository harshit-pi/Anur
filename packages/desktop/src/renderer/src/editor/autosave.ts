import type { Response } from "../../../shared/ipc-contract.ts";

/**
 * Autosave (task 2.7): the page saves 500 ms after typing stops, never while
 * an input method is still composing, one save at a time. Each save is a
 * compare-and-swap against the hash of what was last read or written; if the
 * file changed outside Anur, saving stops and says so, and nothing on disk is
 * overwritten. Until outside changes reload the page (2.13), the person
 * reloads it themselves.
 */

export type SaveStatus = "saved" | "editing" | "saving" | "changed-outside" | "failed";

export type AutosaveDeps = {
  save: (text: string, base: string) => Promise<Response<"doc:save">>;
  text: () => string;
  composing: () => boolean;
  onStatus: (status: SaveStatus, detail: string | null) => void;
  delayMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

export class Autosaver {
  private base: string;
  private savedText: string;
  private timer: unknown = null;
  private inFlight: Promise<void> | null = null;
  private stopped = false;
  private lastFailed = false;
  private readonly delay: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(
    hash: string,
    private readonly deps: AutosaveDeps,
  ) {
    this.base = hash;
    this.savedText = deps.text();
    this.delay = deps.delayMs ?? 500;
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer =
      deps.clearTimer ??
      ((h) => {
        clearTimeout(h as ReturnType<typeof setTimeout>);
      });
  }

  /** True when the last save failed; a close then goes ahead rather than retry forever. */
  get failed(): boolean {
    return this.lastFailed;
  }

  /** True while the page has typing that isn't on disk yet. */
  get dirty(): boolean {
    return !this.stopped && this.deps.text() !== this.savedText;
  }

  /** The text changed: save once typing has paused. */
  changed(): void {
    if (this.stopped) return;
    this.deps.onStatus(this.dirty ? "editing" : "saved", null);
    this.arm(this.delay);
  }

  /** Save now, whatever the timer says; resolves once nothing is left to save. */
  async flush(): Promise<void> {
    this.disarm();
    while (this.inFlight || this.dirty) {
      if (this.inFlight) await this.inFlight;
      else await this.run();
      if (this.stopped || this.lastFailed) return;
    }
  }

  private arm(ms: number) {
    this.disarm();
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.run();
    }, ms);
  }

  private disarm() {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  private run(): Promise<void> {
    if (this.stopped || this.inFlight) return this.inFlight ?? Promise.resolve();
    if (this.deps.composing()) {
      this.arm(100);
      return Promise.resolve();
    }
    const text = this.deps.text();
    if (text === this.savedText) {
      this.deps.onStatus("saved", null);
      return Promise.resolve();
    }
    this.deps.onStatus("saving", null);
    this.lastFailed = false;
    this.inFlight = this.deps
      .save(text, this.base)
      .then(
        (r) => {
          if (r.kind === "saved") {
            this.base = r.hash;
            this.savedText = text;
            this.deps.onStatus(this.dirty ? "editing" : "saved", null);
            if (this.dirty && this.timer === null) this.arm(this.delay);
          } else if (r.kind === "changed") {
            this.stopped = true;
            this.deps.onStatus(
              "changed-outside",
              "This file changed outside Anur, so your latest typing isn't saved. Reopen the doc to see the new version.",
            );
          } else {
            this.lastFailed = true;
            this.deps.onStatus("failed", r.reason);
          }
        },
        (e: unknown) => {
          this.lastFailed = true;
          this.deps.onStatus("failed", (e as Error).message);
        },
      )
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }
}
