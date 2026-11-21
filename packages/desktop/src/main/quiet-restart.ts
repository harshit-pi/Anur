/**
 * When Anur may restart into a downloaded update on its own: it installs on
 * quit and on Restart as before, and besides only when the person can't
 * notice. Automatic installs on, Anur in the background a while, no thread
 * working or waiting on the person, and no window holding unsaved typing,
 * unsent text or a queued run.
 */

/** How long Anur must have been in the background. */
export const AWAY_MS = 30 * 60 * 1000;

export type QuietState = {
  ready: boolean;
  auto: boolean;
  /** Since Anur last had a focused window; null while one has focus. */
  awayMs: number | null;
  threadsBusy: boolean;
  windowsQuiet: boolean;
};

export const quietToRestart = (s: QuietState, away = AWAY_MS): boolean =>
  s.ready && s.auto && s.awayMs !== null && s.awayMs >= away && !s.threadsBusy && s.windowsQuiet;
