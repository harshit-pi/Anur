/**
 * The first-run tour: five steps, each pointing at a part of the window that
 * shows what Anur is for. A step names what it points at by selector, with a
 * second choice when the first isn't on screen, and which view it needs.
 */
export type TourStep = {
  title: string;
  text: string;
  /** What `/anur doc` looks like, shown as code after the text. */
  code?: string;
  target: string;
  fallback?: string;
  side: "left" | "right" | "top";
  view: "page" | "map";
  /** A side panel the step points into, opened for it. */
  panel?: "left" | "right";
  /** Show the map's moves with a ghost pointer: drag a box, then pick one. */
  demo?: "map";
};

export const TOUR: readonly TourStep[] = [
  {
    title: "Your docs are plain files",
    text: "Everything here is Markdown in this folder. Anur reads and writes it, and any other editor still can.",
    target: ".left-sidebar",
    side: "right",
    view: "page",
    panel: "left",
  },
  {
    title: "Ask about a section",
    text: "Click in a section and ask. The thread stays on that section and runs on your own agent.",
    target: ".right-sidebar",
    side: "left",
    view: "page",
    panel: "right",
  },
  {
    title: "Brainstorm on the map",
    text: "Every section is a box. Threads hang off the box they're about, and their ideas come back as options you can explore side by side.",
    target: ".map",
    fallback: ".center",
    side: "left",
    view: "map",
    demo: "map",
  },
  {
    title: "Build and check from the map",
    text: "Pick a box, then Build this section: the agent does what it says with its own tools, drafts, docs or code. Check this section tests its claims. The work hangs off the box.",
    target: ".think-actions",
    fallback: ".right-sidebar",
    side: "left",
    view: "map",
    panel: "right",
  },
  {
    title: "Bring chats in from Claude Code",
    text: "In any Claude Code chat, type this and the chat becomes a doc here, ready to edit:",
    code: "/anur doc",
    target: ".status-bar .status-item",
    side: "top",
    view: "page",
  },
];

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
