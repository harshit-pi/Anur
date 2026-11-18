import { useEffect, useState } from "react";
import { anur } from "../bridge.ts";

/** A new version downloaded: offer a restart. Later leaves it to install when Anur quits. */
export function UpdateCard() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    void anur.call("update:status", {}).then((s) => {
      if (s.ready) setVersion(s.ready);
    });
    return anur.on("app:update-ready", ({ version: v }) => {
      setVersion(v);
    });
  }, []);
  if (!version) return null;
  return (
    <aside className="skill-card" role="dialog" aria-label="Update ready">
      <strong>{`Anur ${version} is ready`}</strong>
      <p>Restart to use it. Your docs are saved, and Anur opens where you left off.</p>
      <div className="skill-card-actions">
        <button
          type="button"
          className="think-button primary"
          onClick={() => {
            void anur.call("update:restart", {});
          }}
        >
          Restart
        </button>
        <button
          type="button"
          className="think-more"
          onClick={() => {
            setVersion(null);
          }}
        >
          Later
        </button>
      </div>
    </aside>
  );
}
