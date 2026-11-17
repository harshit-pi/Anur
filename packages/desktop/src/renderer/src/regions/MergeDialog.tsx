import { useEffect, useState } from "react";
import type { Response } from "../../../shared/ipc-contract.ts";
import { anur } from "../bridge.ts";

type Plan = Extract<Response<"conflict:plan">, { kind: "plan" }>;

/**
 * Merging a sync conflict copy into its original, section by section. Only
 * the sections that differ, or exist on one side, need a choice; the rest
 * are listed as the same.
 */
export function MergeDialog({ copy, onClose }: { copy: string; onClose: () => void }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, "original" | "copy" | boolean>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void anur.call("conflict:plan", { copy }).then((r) => {
      if (r.kind === "plan") setPlan(r);
      else setError(r.reason);
    });
  }, [copy]);

  const merge = () => {
    if (!plan) return;
    setBusy(true);
    void anur.call("conflict:merge", { copy, hashes: plan.hashes, choices }).then((r) => {
      setBusy(false);
      if (r.kind === "merged") onClose();
      else setError(r.reason);
    });
  };

  const heading = (p: string[]) => p.at(-1) ?? "";
  const same = plan?.parts.filter((p) => p.kind === "same").length ?? 0;

  return (
    <div className="palette-backdrop" role="presentation">
      <div
        className="merge-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Merge a conflict copy"
      >
        <header className="merge-head">
          <h2>
            Merge {copy} into {plan?.original ?? "its original"}
          </h2>
          <p className="quiet">
            Two machines changed this doc before they synced. Pick a version for each section that
            differs. The copy goes to the Trash afterwards.
          </p>
        </header>
        {error ? (
          <p className="banner" role="alert">
            {error}
          </p>
        ) : null}
        {plan ? (
          <ol className="merge-list">
            {plan.parts.map((p, i) => {
              const key = String(i);
              if (p.kind === "same") return null;
              if (p.kind === "differs") {
                const pick = choices[key] === "copy" ? "copy" : "original";
                return (
                  <li key={key} className="merge-part">
                    <p className="merge-title truncate">{heading(p.path)}</p>
                    <div className="merge-sides">
                      {(["original", "copy"] as const).map((side) => (
                        <label
                          key={side}
                          className={pick === side ? "merge-side picked" : "merge-side"}
                        >
                          <input
                            type="radio"
                            name={`part-${key}`}
                            checked={pick === side}
                            onChange={() => {
                              setChoices((c) => ({ ...c, [key]: side }));
                            }}
                          />
                          <span className="merge-label">
                            {side === "original" ? "Original" : "Copy"}
                          </span>
                          <pre className="merge-text">
                            {side === "original" ? p.original : p.copy}
                          </pre>
                        </label>
                      ))}
                    </div>
                  </li>
                );
              }
              const keep = choices[key] !== false;
              return (
                <li key={key} className="merge-part">
                  <label className="merge-one">
                    <input
                      type="checkbox"
                      checked={keep}
                      onChange={(e) => {
                        setChoices((c) => ({ ...c, [key]: e.target.checked }));
                      }}
                    />
                    <span>
                      Keep <strong>{heading(p.path)}</strong>, only in the{" "}
                      {p.kind === "only-copy" ? "copy" : "original"}
                    </span>
                  </label>
                  <pre className="merge-text">{p.text}</pre>
                </li>
              );
            })}
          </ol>
        ) : error ? null : (
          <p className="quiet">Reading both files…</p>
        )}
        <footer className="merge-foot">
          {plan ? (
            <span className="quiet">{String(same)} sections are the same in both.</span>
          ) : (
            <span />
          )}
          <div className="merge-buttons">
            <button type="button" className="ask-button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={!plan || busy}
              onClick={merge}
            >
              {busy ? "Merging…" : "Merge"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
