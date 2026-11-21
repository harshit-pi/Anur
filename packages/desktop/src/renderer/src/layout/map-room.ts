/** A rectangle on the map, by its edges. */
export type Rect = { l: number; t: number; r: number; b: number };

/** A section and everything drawn off it: its lane, threads, choices and edits. */
export type Cluster = { id: string; y: number; pinned?: boolean; rects: readonly Rect[] };

/** A cluster's size, to tell when something new hangs off it. */
export const sizeOf = (c: Cluster): number => {
  const t = Math.min(...c.rects.map((r) => r.t));
  const b = Math.max(...c.rects.map((r) => r.b));
  return c.rects.length * 100_000 + Math.round(b - t);
};

/**
 * How far to slide each section so the clusters that grew cover nothing: a
 * neighbour moves straight away from the one that grew, and pushes on in turn.
 * Pinned clusters (the title) never move. Returns each moved section's dy.
 */
export function makeRoom(
  clusters: readonly Cluster[],
  grew: ReadonlySet<string>,
  gap = 12,
): Map<string, number> {
  const dy = new Map<string, number>();
  const at = (c: Cluster) => dy.get(c.id) ?? 0;
  const dir = new Map<string, boolean>();
  const queue = clusters.filter((c) => grew.has(c.id));
  for (let n = 0; n < 500 && queue.length > 0; n++) {
    const a = queue.shift();
    if (!a) break;
    for (const c of clusters) {
      // One that grew stays put, unless what it hit grew at the same moment.
      if (c === a || c.pinned || (grew.has(c.id) && !grew.has(a.id))) continue;
      // A pushed one pushes on the way it's going; one that grew pushes away from itself.
      const down = dir.get(a.id) ?? c.y >= a.y;
      let moved = false;
      // Again until clear: a slide can bring another of c's boxes into the way.
      for (let k = 0; k < 20; k++) {
        let need = 0;
        for (const ra of a.rects)
          for (const rc of c.rects) {
            if (ra.l >= rc.r || rc.l >= ra.r) continue;
            const [at1, ab] = [ra.t + at(a), ra.b + at(a)];
            const [ct, cb] = [rc.t + at(c), rc.b + at(c)];
            if (ct >= ab + gap || at1 >= cb + gap) continue;
            need = Math.max(need, down ? ab + gap - ct : cb + gap - at1);
          }
        if (need <= 0) break;
        dy.set(c.id, at(c) + (down ? need : -need));
        dir.set(c.id, down);
        moved = true;
      }
      if (moved) queue.push(c);
    }
  }
  return dy;
}
