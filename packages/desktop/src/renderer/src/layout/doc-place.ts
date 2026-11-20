/**
 * Where each doc was left, per space on this device: Page or Map, and the
 * section in focus, by heading path, so it reopens there, as Obsidian and
 * VS Code reopen a file where it was.
 */
export type DocPlace = { view: "page" | "map"; section: string[] };

const KEY = (folder: string) => `anur.docPlaces:${folder}`;
/** Enough for any space a person works in; the oldest go first. */
const KEEP = 200;

type Store = Pick<Storage, "getItem" | "setItem">;

function read(storage: Store | undefined, folder: string): Record<string, unknown> {
  try {
    const raw = storage?.getItem(KEY(folder));
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function loadPlace(
  storage: Store | undefined,
  folder: string,
  doc: string,
): DocPlace | null {
  // Read from storage, so checked rather than trusted.
  const p = read(storage, folder)[doc] as { view?: unknown; section?: unknown } | undefined;
  return p &&
    (p.view === "page" || p.view === "map") &&
    Array.isArray(p.section) &&
    p.section.every((h) => typeof h === "string")
    ? { view: p.view, section: p.section }
    : null;
}

export function savePlace(
  storage: Store | undefined,
  folder: string,
  doc: string,
  place: DocPlace,
): void {
  try {
    const others = Object.entries(read(storage, folder)).filter(([d]) => d !== doc);
    const keep = [...others, [doc, place] as const].slice(-KEEP);
    storage?.setItem(KEY(folder), JSON.stringify(Object.fromEntries(keep)));
  } catch {
    // Storage blocked or full: the place just isn't remembered.
  }
}

/** The section at a heading path now, or -1 when it's gone. */
export function sectionIndexOf(sections: readonly { path: string[] }[], path: string[]): number {
  return sections.findIndex(
    (s) => s.path.length === path.length && s.path.every((h, i) => h === path[i]),
  );
}
