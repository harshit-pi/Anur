import { useState } from "react";

/**
 * A new map before it's a file: one box, ready for its name. Naming it makes
 * the doc; Tab also starts a box under it. Left unnamed, nothing is written.
 */
export function BlankMap({
  onName,
}: {
  onName: (name: string, child: boolean) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="map blank-map">
      <div className="map-box title selected blank-map-box">
        <div className="map-box-head">
          <input
            className="map-rename map-box-name"
            aria-label="Map name"
            placeholder="Untitled"
            autoFocus
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== "Tab") return;
              e.preventDefault();
              const name = e.currentTarget.value.trim();
              if (!name) return;
              setBusy(true);
              void onName(name, e.key === "Tab").then((made) => {
                if (!made) setBusy(false);
              });
            }}
          />
        </div>
      </div>
    </div>
  );
}

/** The page's own blank: the title line, ready for a name; naming it makes the doc. */
export function BlankPage({ onName }: { onName: (name: string) => Promise<boolean> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="page-empty blank-page">
      <input
        className="blank-page-title"
        aria-label="Doc name"
        placeholder="Untitled"
        autoFocus
        disabled={busy}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          const name = e.currentTarget.value.trim();
          if (!name) return;
          setBusy(true);
          void onName(name).then((made) => {
            if (!made) setBusy(false);
          });
        }}
      />
    </div>
  );
}
