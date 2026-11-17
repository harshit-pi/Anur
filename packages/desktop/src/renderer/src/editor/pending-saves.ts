/**
 * Saves still on their way to disk when a page closes, as when switching
 * docs or when the dev server hot-reloads the page. A page opening waits for
 * them before reading the doc, so it never starts from older text than the
 * file has. Its own module, so a hot reload of the page keeps it.
 */
let pending: Promise<unknown> = Promise.resolve();

export function track(save: Promise<unknown>): void {
  pending = Promise.all([pending, save.catch(() => undefined)]);
}

export function settled(): Promise<unknown> {
  return pending;
}
