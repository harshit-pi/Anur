import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { anur } from "../bridge.ts";

import "../editor/drawings/assets.ts";
/**
 * An Excalidraw drawing in its own tab, full size and editable, as Obsidian's
 * Excalidraw plugin shows it. Edits save back into the same file a moment
 * after they stop, in the plugin's format, so both apps keep working on it.
 */

const Editor = lazy(async () => {
  const [{ Excalidraw }] = await Promise.all([
    import("@excalidraw/excalidraw"),
    import("@excalidraw/excalidraw/index.css"),
  ]);
  return { default: Excalidraw };
});

type Scene = { elements?: unknown[]; appState?: Record<string, unknown>; files?: unknown };

const isDark = () => {
  const forced = document.documentElement.dataset.theme;
  return forced ? forced === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
};

export function DrawingView({ path }: { path: string }) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "failed"; reason: string }
    | { kind: "ready"; scene: Scene; editable: boolean }
  >({ kind: "loading" });
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const saved = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let current = true;
    setState({ kind: "loading" });
    void anur.call("drawing:read", { target: path, from: path }).then((r) => {
      if (!current) return;
      if (r.kind !== "drawing") {
        setState({ kind: "failed", reason: r.reason });
        return;
      }
      try {
        const scene = JSON.parse(r.scene) as Scene;
        setState({ kind: "ready", scene, editable: r.editable });
      } catch {
        setState({ kind: "failed", reason: "This drawing's data couldn't be read." });
      }
    });
    return () => {
      current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [path]);

  if (state.kind === "loading")
    return <div className="drawing-view quiet">Opening the drawing…</div>;
  if (state.kind === "failed") return <div className="drawing-view quiet">{state.reason}</div>;

  const save = (
    elements: readonly unknown[],
    appState: Record<string, unknown>,
    files: unknown,
  ) => {
    if (!state.editable) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void import("@excalidraw/excalidraw").then(({ serializeAsJSON }) => {
        const scene = serializeAsJSON(
          elements as Parameters<typeof serializeAsJSON>[0],
          appState,
          files as Parameters<typeof serializeAsJSON>[2],
          "local",
        );
        // Opening fires a change too: only a real edit is written.
        if (saved.current === null) {
          saved.current = scene;
          return;
        }
        if (scene === saved.current) return;
        saved.current = scene;
        void anur.call("drawing:save", { path, scene }).then((r) => {
          setSaveNote(r.ok ? null : r.reason);
        });
      });
    }, 600);
  };

  return (
    <div className="drawing-view">
      {saveNote ? <p className="drawing-note">{saveNote}</p> : null}
      <Suspense fallback={<div className="quiet">Opening the drawing…</div>}>
        <Editor
          initialData={{
            elements: (state.scene.elements ?? []) as never,
            appState: { ...(state.scene.appState ?? {}), collaborators: new Map() },
            files: (state.scene.files ?? {}) as never,
            scrollToContent: true,
          }}
          theme={isDark() ? "dark" : "light"}
          viewModeEnabled={!state.editable}
          onChange={(elements, appState, files) => {
            save(elements, appState as unknown as Record<string, unknown>, files);
          }}
        />
      </Suspense>
    </div>
  );
}
