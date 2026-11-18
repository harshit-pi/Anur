/**
 * Undo and redo for the files panel: each step is what one action did to the
 * folder, kept so it can be turned back. Trashed items carry where they
 * landed in the Trash, so they can come back from it.
 */
export type Move = { from: string; to: string };
export type Gone = { path: string; trashed: string | null };

export type FileStep = { label: string } & (
  | { kind: "move"; moves: Move[] }
  | { kind: "trash"; items: Gone[] }
  | { kind: "create"; paths: string[]; gone: Gone[] }
);

const LIMIT = 50;

/** The moves that put things back, last first. */
export const reversed = (moves: readonly Move[]): Move[] =>
  moves.map((m) => ({ from: m.to, to: m.from })).reverse();

/** "Rename" when a move stays in its folder, else "Move". */
export function moveLabel(moves: readonly Move[]): string {
  const dir = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf("/")));
  const only = moves.length === 1 ? moves[0] : undefined;
  return only && dir(only.from) === dir(only.to) ? "Rename" : "Move";
}

export class FileHistory {
  private done: FileStep[] = [];
  private undone: FileStep[] = [];

  /** A new action: it can be undone, and nothing undone before can be redone. */
  record(step: FileStep): void {
    this.done.push(step);
    if (this.done.length > LIMIT) this.done.shift();
    this.undone = [];
  }

  /** The step to undo, taken off; give it back to `undid` once it's undone. */
  takeUndo(): FileStep | undefined {
    return this.done.pop();
  }
  undid(step: FileStep): void {
    this.undone.push(step);
  }

  takeRedo(): FileStep | undefined {
    return this.undone.pop();
  }
  redid(step: FileStep): void {
    this.done.push(step);
  }

  labels(): { undo: string | null; redo: string | null } {
    return { undo: this.done.at(-1)?.label ?? null, redo: this.undone.at(-1)?.label ?? null };
  }

  clear(): void {
    this.done = [];
    this.undone = [];
  }
}
