import { useEffect, useState } from "react";
import { anur } from "../bridge.ts";

/**
 * Threads in a public repo (18.13): `.anur/` is committed by default, so in
 * a repo anyone can read on GitHub, its threads would be published on the
 * next push. Asked once per folder on this device; the safe choice comes
 * first. Decisions are committed either way.
 */
const ANSWERED = (folder: string) => `anur.publicRepoAsked:${folder}`;

function answered(folder: string): boolean {
  try {
    return window.localStorage.getItem(ANSWERED(folder)) === "1";
  } catch {
    return false;
  }
}

function remember(folder: string) {
  try {
    window.localStorage.setItem(ANSWERED(folder), "1");
  } catch {
    // Storage off: the question may come again next time.
  }
}

export function PublicRepoCard() {
  const [shown, setShown] = useState<{ folder: string; repo: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // Read after the await: the folder may have changed meanwhile.
    const alive = { now: true };
    const check = () => {
      void anur.call("anur:publicRepo", {}).then((r) => {
        if (!alive.now) return;
        setShown(
          r.folder && r.repo && !answered(r.folder) ? { folder: r.folder, repo: r.repo } : null,
        );
      });
    };
    check();
    const off = anur.on("folder:changed", check);
    return () => {
      alive.now = false;
      off();
    };
  }, []);
  if (!shown) return null;
  const keepLocal = () => {
    setBusy(true);
    void anur.call("settings:set", { commitAnur: false }).then(() => {
      remember(shown.folder);
      setBusy(false);
      setShown(null);
    });
  };
  const commit = () => {
    remember(shown.folder);
    setShown(null);
  };
  return (
    <aside className="skill-card" role="alertdialog" aria-label="Threads in a public repo">
      <strong>{shown.repo} is public on GitHub</strong>
      <p>
        Anur commits this folder's threads with it, so anyone could read them after your next push.
      </p>
      <p className="quiet">Decisions are committed either way. Change this any time in Settings.</p>
      <div className="skill-card-actions">
        <button type="button" className="think-button primary" disabled={busy} onClick={keepLocal}>
          {busy ? "Working…" : "Keep threads on this Mac"}
        </button>
        <button type="button" className="think-more" disabled={busy} onClick={commit}>
          Commit them
        </button>
      </div>
    </aside>
  );
}
