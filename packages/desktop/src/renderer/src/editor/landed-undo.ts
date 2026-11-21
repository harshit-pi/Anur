/**
 * How to take back each agent edit that landed on its own on an open page,
 * for the Undo on its row in the thread. Kept while the page is open; after
 * that, ⌘Z or History is the way back.
 */
const undos = new Map<string, () => void>();

const key = (thread: string, doc: string, section: readonly string[]) =>
  [thread, doc, ...section].join("\u0000");

export const landedUndo = {
  set(thread: string, doc: string, section: readonly string[], undo: () => void): void {
    undos.set(key(thread, doc, section), undo);
  },
  has(thread: string, doc: string, sections: readonly (readonly string[])[]): boolean {
    return sections.some((s) => undos.has(key(thread, doc, s)));
  },
  /** Takes back every section's edit it can; true when any was. */
  run(thread: string, doc: string, sections: readonly (readonly string[])[]): boolean {
    let any = false;
    for (const s of sections) {
      const k = key(thread, doc, s);
      const undo = undos.get(k);
      if (!undo) continue;
      undos.delete(k);
      undo();
      any = true;
    }
    return any;
  },
  /** The page closed: its edits go back by ⌘Z or History only. */
  dropDoc(doc: string): void {
    for (const k of undos.keys()) if (k.split("\u0000")[1] === doc) undos.delete(k);
  },
};
