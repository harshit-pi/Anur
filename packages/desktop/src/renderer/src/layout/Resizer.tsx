import { useRef } from "react";
import { PANEL, dragged, type Side } from "./panel-widths.ts";

/**
 * The divider between a sidebar and the page: drag it, use the arrow keys
 * when it has focus, or double-click it to go back to the default width.
 */
export function Resizer({
  side,
  width,
  offset,
  onChange,
}: {
  side: Side;
  width: number;
  /** Where the divider sits, in pixels from the window's left or right edge. */
  offset: number;
  onChange: (width: number) => void;
}) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const label = side === "left" ? "Resize the files panel" : "Resize the section panel";
  return (
    <div
      className={`resizer resizer-${side}`}
      style={side === "left" ? { left: offset - 3 } : { right: offset - 3 }}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={PANEL[side].min}
      aria-valuemax={PANEL[side].max}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, width };
        document.body.classList.add("resizing");
      }}
      onPointerMove={(e) => {
        if (start.current) onChange(dragged(side, start.current.width, start.current.x, e.clientX));
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onLostPointerCapture={() => {
        // Ends every drag, including one the window loses mid-way.
        start.current = null;
        document.body.classList.remove("resizing");
      }}
      onDoubleClick={() => {
        onChange(PANEL[side].initial);
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 48 : 16;
        const grow = side === "left" ? "ArrowRight" : "ArrowLeft";
        const shrink = side === "left" ? "ArrowLeft" : "ArrowRight";
        if (e.key === grow) onChange(dragged(side, width, 0, side === "left" ? step : -step));
        else if (e.key === shrink)
          onChange(dragged(side, width, 0, side === "left" ? -step : step));
        else return;
        e.preventDefault();
      }}
    />
  );
}
