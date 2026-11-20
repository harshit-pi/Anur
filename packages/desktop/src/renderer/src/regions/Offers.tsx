import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { anur } from "../bridge.ts";
import { dayOf, readStar, shouldAsk, used, writeStar } from "../layout/star-prompt.ts";
import { StarPrompt } from "./StarPrompt.tsx";

/**
 * Every card Anur offers in the corner, in one place: one at a time, the most
 * pressing first, never in a window's first seconds or while a thread runs.
 * An offer only says whether it's due and how it looks; add new ones to OFFERS.
 */
type Offer = {
  id: string;
  /** The card to show now, or null when it isn't due. */
  due: () => Promise<((done: () => void) => ReactNode) | null>;
};

/** How long a window is open before any card shows. */
const SETTLE_MS = 5000;

const OFFERS: Offer[] = [
  { id: "public-repo", due: publicRepoDue },
  { id: "opener", due: openerDue },
  { id: "star", due: starDue },
];

export function Offers() {
  const [shown, setShown] = useState<{ id: string; card: (done: () => void) => ReactNode } | null>(
    null,
  );
  const [settled, setSettled] = useState(false);
  const [busy, setBusy] = useState(0);
  /** Bumped when something an offer depends on may have changed. */
  const [n, setN] = useState(0);
  const running = useRef(new Set<string>());
  useEffect(() => {
    const t = window.setTimeout(() => {
      setSettled(true);
    }, SETTLE_MS);
    const offFolder = anur.on("folder:changed", () => {
      setN((x) => x + 1);
    });
    const offThread = anur.on("thread:event", (e) => {
      if (e.kind !== "thread") return;
      const was = running.current.size;
      if (e.thread.busy) running.current.add(e.thread.id);
      else running.current.delete(e.thread.id);
      if (running.current.size !== was) setBusy(running.current.size);
    });
    return () => {
      window.clearTimeout(t);
      offFolder();
      offThread();
    };
  }, []);
  useEffect(() => {
    if (shown || !settled || busy > 0) return;
    // Read after each await: the folder may have changed meanwhile.
    const alive = { now: true };
    void (async () => {
      for (const o of OFFERS) {
        const card = await o.due().catch(() => null);
        if (!alive.now) return;
        if (card) {
          setShown({ id: o.id, card });
          return;
        }
      }
    })();
    return () => {
      alive.now = false;
    };
  }, [shown, settled, busy, n]);
  const done = useCallback(() => {
    setShown(null);
  }, []);
  if (!shown) return null;
  return <div className="corner-cards">{shown.card(done)}</div>;
}

// --- Storage helpers: a choice remembered on this device.

function flag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function setFlag(key: string) {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    // Storage off: the offer may come again next time.
  }
}

// --- This repo is public on GitHub (18.13): first, since it's about privacy.

const publicAsked = (folder: string) => `anur.publicRepoAsked:${folder}`;

async function publicRepoDue() {
  const r = await anur.call("anur:publicRepo", {});
  if (!r.folder || !r.repo || flag(publicAsked(r.folder))) return null;
  const { folder, repo } = r;
  return (done: () => void) => <PublicRepoCard folder={folder} repo={repo} done={done} />;
}

function PublicRepoCard({
  folder,
  repo,
  done,
}: {
  folder: string;
  repo: string;
  done: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const finish = () => {
    setFlag(publicAsked(folder));
    done();
  };
  return (
    <aside className="skill-card" role="alertdialog" aria-label="Threads in a public repo">
      <strong>{repo} is public on GitHub</strong>
      <p>
        Anur commits this folder's threads with it, so anyone could read them after your next push.
      </p>
      <div className="skill-card-actions">
        <button
          type="button"
          className="think-button primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void anur.call("settings:set", { commitAnur: false }).then(finish);
          }}
        >
          {busy ? "Working…" : "Keep threads on this Mac"}
        </button>
        <button type="button" className="think-more" disabled={busy} onClick={finish}>
          Commit them
        </button>
      </div>
    </aside>
  );
}

// --- Open Markdown files with Anur, as a browser offers to be the default.

async function openerDue() {
  const o = await anur.call("opener:status", {});
  if (!o.can || o.isAnur || o.dismissed) return null;
  const current = o.current;
  return (done: () => void) => <OpenerCard current={current} done={done} />;
}

function OpenerCard({ current, done }: { current: string | null; done: () => void }) {
  const [failed, setFailed] = useState(false);
  return (
    <aside className="skill-card" role="dialog" aria-label="Open Markdown files with Anur">
      <strong>Open Markdown files with Anur?</strong>
      <p>
        {current
          ? `${current} opens .md files from Finder now. Anur can open them instead, in the folder they belong to.`
          : "Anur can open .md files from Finder, in the folder they belong to."}
      </p>
      {failed ? <p className="skill-card-error">macOS didn't allow the change.</p> : null}
      <div className="skill-card-actions">
        <button
          type="button"
          className="think-button primary"
          onClick={() => {
            void anur.call("opener:act", { action: "make" }).then((r) => {
              if (r.ok) done();
              else setFailed(true);
            });
          }}
        >
          Use Anur
        </button>
        <button
          type="button"
          className="think-more"
          onClick={() => {
            void anur.call("opener:act", { action: "dismiss" });
            done();
          }}
        >
          Not now
        </button>
      </div>
    </aside>
  );
}

// --- After a few days of use: a star on GitHub, or a feature to ask for. Last, and rare.

function starDue() {
  const today = dayOf(new Date());
  const s = used(readStar(window.localStorage), today);
  writeStar(window.localStorage, s);
  if (!shouldAsk(s, today)) return Promise.resolve(null);
  return Promise.resolve((done: () => void) => <StarPrompt done={done} />);
}
