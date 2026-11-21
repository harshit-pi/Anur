/**
 * The list of a section's threads in Think, grouped by what each needs, with each thread's name.
 */
import type { ThreadView } from "../../../shared/ipc-contract.ts";
import { formatTokens } from "../layout/tokens.ts";
import { ago } from "./thread-time.ts";
import { withBranches } from "./thread-steps.ts";
import { countOf } from "./think-parts.tsx";

export type ThreadState = "needs-you" | "running" | "done";

/**
 * A section's threads by what they need from the person: those that need
 * them first, then those running, then those done, folded away.
 */
export function GroupedThreads({
  threads,
  stateOf,
  onOpen,
}: {
  threads: ThreadView[];
  stateOf: (t: ThreadView) => ThreadState;
  onOpen: (id: string) => void;
}) {
  const needs = threads.filter((t) => stateOf(t) === "needs-you");
  const rest = threads.filter((t) => stateOf(t) !== "needs-you");
  return (
    <div className="think-groups">
      {needs.length > 0 ? (
        <>
          <h3 className="think-subhead">
            <span className="think-needs-dot" aria-hidden="true" />
            Needs you ({String(needs.length)})
          </h3>
          <ThreadList threads={needs} onOpen={onOpen} />
        </>
      ) : null}
      {/* The rest under their own heading, so they never read as needing you too. */}
      {needs.length > 0 && rest.length > 0 ? (
        <h3 className="think-subhead">Others ({String(rest.length)})</h3>
      ) : null}
      <ThreadList threads={withBranches(rest)} onOpen={onOpen} />
    </div>
  );
}

export const PURPOSE = { build: "Build", check: "Check" } as const;

/** A thread's title, tagged Build or Check when it's an action (15.7). */
export function ThreadName({ thread }: { thread: ThreadView }) {
  if (!thread.purpose) return <>{thread.title}</>;
  const tag = PURPOSE[thread.purpose];
  const title = thread.title.startsWith(`${tag}: `)
    ? thread.title.slice(tag.length + 2)
    : thread.title;
  const state = thread.action?.state ?? "running";
  return (
    <>
      <span className={`thread-state ${state}`} title={`${tag} · ${STATE_WORD[state]}`}>
        {STATE_MARK[state]}
      </span>
      {title}
    </>
  );
}

export const STATE_MARK = {
  running: "⟳",
  needs: "!",
  done: "✓",
  failed: "×",
  stopped: "■",
} as const;

export const STATE_WORD = {
  running: "Running",
  needs: "Needs you",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
} as const;

export function ThreadList({
  threads,
  onOpen,
  showSection = false,
}: {
  threads: ThreadView[];
  onOpen: (id: string) => void;
  showSection?: boolean;
}) {
  if (threads.length === 0) return null;
  return (
    <ul className="think-threads">
      {threads.map((t) => (
        <li key={t.id}>
          <button
            type="button"
            className={`think-thread${t.branchedFrom && threads.some((x) => x.id === t.branchedFrom?.thread) ? " branch" : ""}`}
            onClick={() => {
              onOpen(t.id);
            }}
          >
            {showSection ? (
              <span className="think-thread-where">
                {t.path ? t.path.at(-1) : "A section that's gone"}
              </span>
            ) : null}
            <span className="think-thread-top">
              <span className="think-thread-title">
                <ThreadName thread={t} />
              </span>
              {t.by || t.lastAt ? (
                <span className="think-thread-when">
                  {t.by ? <span className="think-thread-by">{t.by}</span> : null}
                  {t.by && t.lastAt ? ", " : ""}
                  {t.lastAt ? ago(t.lastAt) : ""}
                </span>
              ) : null}
            </span>
            <span className="think-thread-last">
              {t.busy ? (
                <>
                  <span className="think-running-dot" aria-hidden="true" />
                  Running…
                </>
              ) : (
                (t.lastReply ?? "No reply yet")
              )}
            </span>
            <span className="think-thread-meta">
              {`${countOf(t.items.filter((i) => i.kind === "message").length, "message")}${
                t.tokens ? ` · ${formatTokens(t.tokens.used)} tokens` : ""
              }`}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
