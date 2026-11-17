/**
 * Sidebar widths: dragged by the person, kept within bounds, and remembered
 * on this device. They are a per-person convenience, so they live in the
 * page's own storage, never in the vault.
 */
export type Side = "left" | "right";

export const PANEL = {
  left: { min: 180, max: 480, initial: 260 },
  right: { min: 220, max: 520, initial: 300 },
} as const;

const KEY = "anur.panelWidths";

export function clampWidth(side: Side, width: number): number {
  const { min, max } = PANEL[side];
  if (!Number.isFinite(width)) return PANEL[side].initial;
  return Math.round(Math.min(max, Math.max(min, width)));
}

export type Widths = Record<Side, number>;

export function initialWidths(): Widths {
  return { left: PANEL.left.initial, right: PANEL.right.initial };
}

/** Read remembered widths; storage can be missing or blocked, so anything odd falls back. */
export function loadWidths(storage: Pick<Storage, "getItem"> | undefined): Widths {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return initialWidths();
    const parsed = JSON.parse(raw) as Partial<Record<Side, unknown>>;
    return {
      left: clampWidth("left", Number(parsed.left)),
      right: clampWidth("right", Number(parsed.right)),
    };
  } catch {
    return initialWidths();
  }
}

export function saveWidths(storage: Pick<Storage, "setItem"> | undefined, widths: Widths): void {
  try {
    storage?.setItem(KEY, JSON.stringify(widths));
  } catch {
    // Storage blocked or full: the widths just aren't remembered.
  }
}

/** The width after a drag: the left panel grows to the right, the right panel to the left. */
export function dragged(side: Side, startWidth: number, startX: number, x: number): number {
  const delta = side === "left" ? x - startX : startX - x;
  return clampWidth(side, startWidth + delta);
}
