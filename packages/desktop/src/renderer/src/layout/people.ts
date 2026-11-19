/**
 * Who works in the open folder (people), for the page: an `owner` property
 * holds handles, and the page shows each as the name its person goes by.
 */
export type KnownPerson = { handle: string | null; name: string };

let known: KnownPerson[] = [];

/** The open folder's people, as App reads them whenever the folder changes. */
export function setPeople(people: readonly KnownPerson[]): void {
  known = [...people];
  // Owner chips already on the page take their names now, not on the next redraw.
  for (const chip of document.querySelectorAll<HTMLElement>("[data-owner]")) {
    const handle = chip.dataset.owner ?? "";
    chip.textContent = nameOfHandle(handle);
    chip.title = chip.textContent === handle ? "" : handle;
  }
}

/** A handle's name, else the handle as written. */
export const nameOfHandle = (handle: string) =>
  known.find((p) => p.handle === handle)?.name ?? handle;

/** Everyone to suggest as an owner, by the value an `owner` list stores. */
export const ownerChoices = () => known.map((p) => ({ value: p.handle ?? p.name, name: p.name }));
