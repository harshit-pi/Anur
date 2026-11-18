import { useEffect, useState } from "react";
import { anur } from "../bridge.ts";

/** An image opened from the files panel, shown whole in its tab. Main reads it, as for an embed. */
export function ImageView({ path }: { path: string }) {
  const [shown, setShown] = useState<{ path: string; src: string | null; reason: string | null }>({
    path,
    src: null,
    reason: null,
  });
  useEffect(() => {
    let current = true;
    const load = () => {
      void anur.call("image:read", { target: path, from: path }).then((r) => {
        if (!current) return;
        setShown(
          r.kind === "image"
            ? { path, src: r.dataUrl, reason: null }
            : { path, src: null, reason: r.reason },
        );
      });
    };
    load();
    // Read again when the window comes back, so an edit made elsewhere shows.
    window.addEventListener("focus", load);
    return () => {
      current = false;
      window.removeEventListener("focus", load);
    };
  }, [path]);
  const name = path.split("/").pop() ?? path;
  return (
    <div className="image-view">
      {shown.path === path && shown.src ? (
        <img src={shown.src} alt={name} draggable={false} />
      ) : shown.path === path && shown.reason ? (
        <p className="quiet">{shown.reason}</p>
      ) : null}
    </div>
  );
}
