/**
 * The first-run tour: five steps, each pointing at a part of the window that
 * shows what Anur is for. A step names what it points at by selector, with a
 * second choice when the first isn't on screen, and which view it needs.
 */
export type TourStep = {
  title: string;
  text: string;
  /** What `/anur map` looks like, shown as code after the text. */
  code?: string;
  target: string;
  fallback?: string;
  side: "left" | "right" | "top";
  view: "page" | "map";
  /** A switchable Core feature the step is about; the tour skips it while that's off. */
  feature?: "links" | "history" | "actions";
  /** A side panel the step points into, opened for it. */
  panel?: "left" | "right";
  /** A ghost pointer shows it: "map" drags a box and picks one; "keys" adds boxes with Tab and Enter. */
  demo?: "map" | "keys";
};

export const TOUR: readonly TourStep[] = [
  {
    title: "Think on a map",
    text: "Each box is one idea, and you arrange them as you think. Every map is also a doc: Page shows it as text.",
    target: ".map",
    fallback: ".center",
    side: "left",
    view: "map",
    demo: "map",
  },
  {
    title: "Add with Tab and Enter",
    text: "Pick a box: Tab adds one under it, Enter one beside it. Double-click a box to rename it.",
    target: ".map",
    fallback: ".center",
    side: "left",
    view: "map",
    demo: "keys",
  },
  {
    title: "Ask about a box",
    text: "Pick a box and ask, on your own agent. It starts from that box, not a blank chat, and the thread and its options hang off the box.",
    target: ".right-sidebar",
    side: "left",
    view: "map",
    panel: "right",
  },
  {
    title: "Build and check from the map",
    feature: "actions",
    text: "Build this section has the agent do what the box says, with its own tools. Check this section tests its claims. The work hangs under the box.",
    target: ".think-actions",
    fallback: ".right-sidebar",
    side: "left",
    view: "map",
    panel: "right",
  },
  {
    title: "Bring chats in from Claude Code",
    text: "In any Claude Code chat, type this and the chat becomes a map here, ready to edit:",
    code: "/anur map",
    target: ".status-bar .status-item",
    side: "top",
    view: "map",
  },
];

/** The steps to show: those about a switched-off Core feature are left out. */
export const tourSteps = (flags: Record<"links" | "history" | "actions", boolean>) =>
  TOUR.filter((s) => !s.feature || flags[s.feature]);

export type Rect = { left: number; top: number; width: number; height: number };

/** Where the bubble goes beside the lit area, kept inside the window. */
export function bubbleAt(
  hole: Rect,
  side: TourStep["side"],
  bubble: { width: number; height: number },
  win: { width: number; height: number },
  gap = 16,
): { left: number; top: number } {
  const clamp = (v: number, max: number) => Math.max(12, Math.min(v, max - 12));
  if (side === "top")
    return {
      left: clamp(hole.left, win.width - bubble.width),
      top: clamp(hole.top - bubble.height - gap, win.height - bubble.height),
    };
  const left = side === "right" ? hole.left + hole.width + gap : hole.left - bubble.width - gap;
  return {
    left: clamp(left, win.width - bubble.width),
    top: clamp(hole.top + 30, win.height - bubble.height),
  };
}
