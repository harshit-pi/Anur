import { anur } from "../bridge.ts";
import { FEATURE_URL, REPO_URL } from "../layout/github.ts";
import { readStar, snoozed, writeStar } from "../layout/star-prompt.ts";
import { GitHubIcon } from "./Icons.tsx";

/** After a few days of use: a star on GitHub, or a feature to ask for. Offers decides when. */
export function StarPrompt({ done }: { done: () => void }) {
  const finish = (finished: boolean) => {
    const s = readStar(window.localStorage);
    writeStar(window.localStorage, finished ? { ...s, done: true } : snoozed(s, new Date()));
    done();
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
