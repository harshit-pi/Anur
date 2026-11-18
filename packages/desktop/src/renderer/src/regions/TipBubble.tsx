import { useLayoutEffect, useRef, useState } from "react";
import { TIPS, tipAt, type TipOffer } from "../layout/tips.ts";

/** A one-time tip beside what it's about, until Got it or Esc. */
export function TipBubble({ tip, onDone }: { tip: TipOffer; onDone: () => void }) {
  const t = TIPS[tip.id];
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const b = box.current;
    setAt(
      tipAt(
        tip.rect,
        t.side,
        { width: b?.offsetWidth ?? 260, height: b?.offsetHeight ?? 90 },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [tip, t.side]);
  return (
    <div
      ref={box}
      className={`tip-bubble ${t.side}`}
      role="status"
      style={at ?? { visibility: "hidden" }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onDone();
      }}
    >
      <strong>{t.title}</strong>
      <span>{t.text}</span>
      <button type="button" className="tip-got" onClick={onDone}>
        Got it
      </button>
    </div>
  );
}
