import { useEffect, useState } from "react";
import { anur } from "../bridge.ts";
import { FEATURE_URL, REPO_URL } from "../layout/github.ts";
import { dayOf, readStar, shouldAsk, snoozed, used, writeStar } from "../layout/star-prompt.ts";
import { GitHubIcon } from "./Icons.tsx";

/** After a few days of use: a star on GitHub, or a feature to ask for. Asked rarely. */
export function StarPrompt() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const today = dayOf(new Date());
    const s = used(readStar(window.localStorage), today);
    writeStar(window.localStorage, s);
    if (!shouldAsk(s, today)) return;
    // A little after opening, not in the way of what the person came to do.
    const t = window.setTimeout(() => {
      setShown(true);
    }, 4000);
    return () => {
      window.clearTimeout(t);
    };
  }, []);
  if (!shown) return null;
  const finish = (done: boolean) => {
    const s = readStar(window.localStorage);
    writeStar(window.localStorage, done ? { ...s, done: true } : snoozed(s, new Date()));
    setShown(false);
  };
  const open = (url: string) => void anur.call("link:open-external", { url });
  return (
    <div className="star-prompt" role="dialog" aria-label="Enjoying Anur?">
      <button
        type="button"
        className="star-prompt-close"
        aria-label="Close"
        onClick={() => {
          finish(true);
        }}
      >
        ×
      </button>
      <p className="star-prompt-title">Enjoying Anur?</p>
      <p className="star-prompt-body">
        A star on GitHub helps others find it. Missing something? Ask for it there.
      </p>
      <div className="star-prompt-actions">
        <button
          type="button"
          className="settings-button primary"
          onClick={() => {
            open(REPO_URL);
            finish(true);
          }}
        >
          <GitHubIcon /> Star on GitHub
        </button>
        <button
          type="button"
          className="settings-button"
          onClick={() => {
            open(FEATURE_URL);
            finish(false);
          }}
        >
          Suggest a feature
        </button>
        <button
          type="button"
          className="star-prompt-later"
          onClick={() => {
            finish(false);
          }}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
