/**
 * One-time tips: a small note the first time someone meets a feature,
 * pointing at it. Each shows once, after the tour, and one at a time. A part
 * of the window offers its tip with `offerTip`; App decides whether it shows.
 */
export const TIPS = {
  fold: {
    title: "Fold a section",
    text: "Click the arrow to tuck this section away; click it again to open it.",
    side: "below",
  },
  "files-in": {
    title: "Bring files in",
    text: "Drag files here from Finder, or copy them in Finder and paste with ⌘V.",
    side: "right",
  },
  "files-undo": {
    title: "Undo with ⌘Z",
    text: "Moves, renames, new files and Move to Trash can be undone here, with ⌘Z in the files panel.",
    side: "right",
  },
  tabs: {
    title: "Arrange your tabs",
    text: "Drag a tab to move it. Right-click to pin it or put it in a group.",
    side: "below",
  },
} as const;

export type TipId = keyof typeof TIPS;
export type TipRect = { left: number; top: number; width: number; height: number };
export type TipOffer = { id: TipId; rect: TipRect };

export const TIP_EVENT = "anur:tip";

/** Offer a tip pointing at `el`; App shows it if it's new and nothing else is up. */
export function offerTip(id: TipId, el: Element | null | undefined) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  const rect = { left: r.left, top: r.top, width: r.width, height: r.height };
  window.dispatchEvent(new CustomEvent<TipOffer>(TIP_EVENT, { detail: { id, rect } }));
}

export const isTipId = (id: string): id is TipId => id in TIPS;

/** Where the tip sits: right of its anchor, or under it, inside the window. */
export function tipAt(
  rect: TipRect,
  side: "right" | "below",
  size: { width: number; height: number },
  win: { width: number; height: number },
): { left: number; top: number } {
  const clamp = (v: number, max: number) => Math.max(8, Math.min(v, max - 8));
  if (side === "below")
    return {
      left: clamp(rect.left, win.width - size.width),
      top: clamp(rect.top + rect.height + 10, win.height - size.height),
    };
  return {
    left: clamp(rect.left + rect.width + 12, win.width - size.width),
    top: clamp(rect.top + rect.height / 2 - 22, win.height - size.height),
  };
}
