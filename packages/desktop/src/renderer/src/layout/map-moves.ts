/**
 * How far each box that isn't a section has been dragged on its own (30.35):
 * its own offset plus every parent's up to its section, so a dragged choice
 * carries what hangs off it. Sections are placed absolutely, elsewhere.
 */
export function ownOffsets(
  boxes: readonly { id: string; kind: string; parent?: string | null }[],
  moved: Readonly<Record<string, { x: number; y: number }>>,
  drag: { id: string; dx: number; dy: number } | null,
): Map<string, { dx: number; dy: number }> {
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const out = new Map<string, { dx: number; dy: number }>();
  for (const b of boxes) {
    if (b.kind === "section") continue;
    let dx = 0;
    let dy = 0;
    for (let at: (typeof boxes)[number] | undefined = b; at && at.kind !== "section";) {
      const m = moved[at.id];
      if (m) {
        dx += m.x;
        dy += m.y;
      }
      if (drag?.id === at.id) {
        dx += drag.dx;
        dy += drag.dy;
      }
      at = at.parent ? byId.get(at.parent) : undefined;
    }
    if (dx !== 0 || dy !== 0) out.set(b.id, { dx, dy });
  }
  return out;
}
