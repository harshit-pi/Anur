import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { TOUR, bubbleAt, type Rect } from "../layout/tour.ts";

/**
 * The tour's overlay: the window dims, the step's part stays lit, and a
 * bubble beside it says what it's for, with "2 of 5", Back, Next and Skip.
 * Clicks outside the bubble do nothing, so no one wanders off mid-tour.
 */
export function Tour({
  step,
  onStep,
  onEnd,
}: {
  step: number;
  onStep: (n: number) => void;
  onEnd: () => void;
}) {
  const s = TOUR[step];
  const bubble = useRef<HTMLDivElement>(null);
  const [hole, setHole] = useState<Rect | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  // Measure the lit part; again once panels and the map have settled.
  useLayoutEffect(() => {
    if (!s) return;
    const measure = () => {
      const el =
        document.querySelector(s.target) ??
        (s.fallback ? document.querySelector(s.fallback) : null);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const pad = 6;
      const lit = {
        left: r.left - pad,
        top: r.top - pad,
        width: r.width + pad * 2,
        height: r.height + pad * 2,
      };
      setHole(lit);
      const b = bubble.current;
      const size = { width: b?.offsetWidth ?? 300, height: b?.offsetHeight ?? 160 };
      setAt(bubbleAt(lit, s.side, size, { width: window.innerWidth, height: window.innerHeight }));
    };
    measure();
    const later = [setTimeout(measure, 120), setTimeout(measure, 450)];
    window.addEventListener("resize", measure);
    return () => {
      later.forEach(clearTimeout);
      window.removeEventListener("resize", measure);
    };
  }, [s]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEnd();
      else if (e.key === "ArrowRight" || e.key === "Enter") onStep(step + 1);
      else if (e.key === "ArrowLeft" && step > 0) onStep(step - 1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, [step, onStep, onEnd]);

  if (!s) return null;
  const last = step === TOUR.length - 1;
  return (
    <div className="tour" role="presentation">
      <div className="tour-block" />
      {s.demo === "map" ? <MapDemo /> : null}
      {hole ? (
        <div
          className="tour-hole"
          style={{ left: hole.left, top: hole.top, width: hole.width, height: hole.height }}
        />
      ) : null}
      <div
        ref={bubble}
        className="tour-bubble"
        role="dialog"
        aria-label={s.title}
        style={at ? { left: at.left, top: at.top } : { visibility: "hidden" }}
      >
        <h4>{s.title}</h4>
        <p>
          {s.text}
          {s.code ? (
            <>
              {" "}
              <code>{s.code}</code>
            </>
          ) : null}
        </p>
        <div className="tour-foot">
          <span className="tour-count">{`${String(step + 1)} of ${String(TOUR.length)}`}</span>
          <span className="tour-dots" aria-hidden="true">
            {TOUR.map((_, i) => (
              <i key={i} className={i === step ? "on" : ""} />
            ))}
          </span>
          <span className="tour-grow" />
          <button type="button" className="tour-skip" onClick={onEnd}>
            Skip
          </button>
          {step > 0 ? (
            <button
              type="button"
              className="tour-back"
              onClick={() => {
                onStep(step - 1);
              }}
            >
              Back
            </button>
          ) : null}
          <button
            type="button"
            className="tour-next"
            autoFocus
            onClick={() => {
              if (last) onEnd();
              else onStep(step + 1);
            }}
          >
            {last ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const centre = (el: Element) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

/**
 * A ghost pointer showing what the map takes: it drags a box away and back,
 * then clicks one, over and over while the step is up. Only for show: the
 * box moves by CSS for a moment and nothing is saved.
 */
function MapDemo() {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const [down, setDown] = useState(false);
  const [ripple, setRipple] = useState<{ x: number; y: number; n: number } | null>(null);
  useEffect(() => {
    const demo = { live: true };
    /** Read fresh after each wait: the step may have moved on meanwhile. */
    const stopped = () => !demo.live;
    let moved: HTMLElement | null = null;
    const run = async () => {
      await wait(500);
      while (demo.live) {
        const boxes = [...document.querySelectorAll<HTMLElement>(".map .map-box")];
        const drag = boxes.find((b) => !b.classList.contains("title")) ?? boxes[0];
        const pick = boxes.find((b) => b !== drag) ?? drag;
        const map = document.querySelector(".map");
        if (!drag || !pick || !map) return;
        const m = map.getBoundingClientRect();
        setAt({ x: m.left + m.width * 0.7, y: m.top + m.height * 0.75 });
        await wait(400);
        if (stopped()) break;
        setAt(centre(drag));
        await wait(800);
        setDown(true);
        await wait(250);
        // Drag it away a little, then back where it was.
        moved = drag;
        drag.style.transition = "translate 0.7s cubic-bezier(0.3, 0.6, 0.2, 1)";
        drag.style.translate = "70px 50px";
        const from = centre(drag);
        setAt({ x: from.x + 70, y: from.y + 50 });
        await wait(900);
        drag.style.translate = "";
        setAt(centre(drag));
        await wait(800);
        setDown(false);
        await wait(300);
        if (stopped()) break;
        // Then a click on another box picks it.
        const p = centre(pick);
        setAt(p);
        await wait(800);
        setDown(true);
        setRipple((r) => ({ ...p, n: (r?.n ?? 0) + 1 }));
        pick.classList.add("tour-picked");
        await wait(200);
        setDown(false);
        await wait(1600);
        pick.classList.remove("tour-picked");
        setAt(null);
        await wait(1200);
      }
    };
    void run();
    return () => {
      demo.live = false;
      if (moved) {
        moved.style.translate = "";
        moved.style.transition = "";
      }
      document.querySelectorAll(".tour-picked").forEach((b) => {
        b.classList.remove("tour-picked");
      });
    };
  }, []);
  return (
    <>
      {ripple ? (
        <span key={ripple.n} className="tour-ripple" style={{ left: ripple.x, top: ripple.y }} />
      ) : null}
      <svg
        className={`tour-pointer${down ? " down" : ""}`}
        style={at ? { left: at.x, top: at.y, opacity: 1 } : { opacity: 0 }}
        width="22"
        height="22"
        viewBox="0 0 22 22"
        aria-hidden="true"
      >
        <path d="M3 2 L3 18 L7.5 13.8 L10.5 20 L13.2 18.8 L10.3 12.6 L16.5 12.6 Z" />
      </svg>
    </>
  );
}
