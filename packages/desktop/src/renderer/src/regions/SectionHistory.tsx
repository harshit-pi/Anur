/**
 * A section's history in Think: its earlier versions, each against now, with what changed.
 */
import { useEffect, useState } from "react";
import { diffLines, type SectionNode } from "@anur/core";
import type { ThreadView } from "../../../shared/ipc-contract.ts";
import { anur } from "../bridge.ts";
import { when } from "./thread-time.ts";
import { countOf } from "./think-parts.tsx";

export type HistoryList = {
  versions: {
    id: string;
    at: string;
    cause: string;
    summary: string;
    text: string;
    thread: string | null;
  }[];
  commits: { hash: string; at: string; author: string; subject: string; text: string }[];
};

export const CAUSE: Record<string, string> = {
  start: "First seen",
  typing: "Typed",
  apply: "From a thread",
  restore: "Restored",
  outside: "Changed outside",
};

/** A version's lines against the section now: kept, only in this version, or only now (5.2). */
export function versusNow(
  version: string,
  now: string,
): { kind: "same" | "differs" | "gone"; text: string }[] {
  const a = now.split("\n");
  const b = version.split("\n");
  const out: { kind: "same" | "differs" | "gone"; text: string }[] = [];
  let bi = 0;
  for (const h of diffLines(a, b)) {
    while (bi < h.bFrom) out.push({ kind: "same", text: b[bi++] ?? "" });
    for (let ai = h.aFrom; ai < h.aTo; ai++) out.push({ kind: "gone", text: a[ai] ?? "" });
    for (; bi < h.bTo; bi++) out.push({ kind: "differs", text: b[bi] ?? "" });
  }
  while (bi < b.length) out.push({ kind: "same", text: b[bi++] ?? "" });
  return out;
}

/**
 * A section's history (group 5): its versions newest first, and in a git
 * repo the commits that changed it. Each opens to its text, with the lines
 * that differ from now marked, and restores into this section only.
 */
export function SectionHistory({
  docPath,
  docText,
  section,
  writable,
  onThread,
}: {
  docPath: string;
  docText: () => string;
  section: SectionNode;
  writable: boolean;
  onThread: (id: string) => void;
}) {
  const [list, setList] = useState<HistoryList | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const load = () => {
    void anur
      .call("history:list", {
        path: docPath,
        text: docText(),
        section: { index: section.index, path: section.path },
      })
      .then(setList);
  };
  const now = docText().slice(section.subtreeRange.from, section.subtreeRange.to).trimEnd();
  const rows = [
    ...(list?.versions ?? []).map((v) => ({
      key: v.id,
      at: v.at,
      label: CAUSE[v.cause] ?? v.cause,
      summary: v.summary,
      text: v.text,
      thread: v.thread,
    })),
    ...(list?.commits ?? []).map((c) => ({
      key: c.hash,
      at: c.at,
      label: "Commit",
      summary: `${c.subject} (${c.author})`,
      text: c.text,
      thread: null,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <details
      className="think-history"
      onToggle={(e) => {
        if (e.currentTarget.open && !list) load();
      }}
    >
      <summary className="think-subhead">History{list ? ` (${String(rows.length)})` : ""}</summary>
      {list && rows.length === 0 ? (
        <p className="quiet think-inputs-note">No earlier versions of this section yet.</p>
      ) : null}
      <ul>
        {rows.map((r) => {
          const current = r.text.trimEnd() === now;
          const open = shown === r.key;
          return (
            <li key={r.key} className={open ? "open" : undefined}>
              <button
                type="button"
                className="think-history-row"
                onClick={() => {
                  setShown(open ? null : r.key);
                }}
              >
                <span className="think-history-when">{when(r.at)}</span>
                <span className="think-history-cause">{r.label}</span>
                <span className="think-history-summary truncate">{r.summary}</span>
                {current ? <span className="quiet">now</span> : null}
              </button>
              {open ? (
                <div className="think-history-body">
                  <pre className="think-history-text">
                    {versusNow(r.text.trimEnd(), now).map((l, i) => (
                      <span key={i} className={l.kind === "same" ? undefined : l.kind}>
                        {l.text}
                        {"\n"}
                      </span>
                    ))}
                  </pre>
                  <p className="quiet think-history-key">
                    <span className="differs">Only here</span>{" "}
                    <span className="gone">Only now</span>
                  </p>
                  <div className="think-offer-actions">
                    {writable && !current ? (
                      <button
                        type="button"
                        className="think-button primary"
                        onClick={() => {
                          window.dispatchEvent(
                            new CustomEvent("anur:restore-section", {
                              detail: { path: section.path, text: r.text, from: r.at },
                            }),
                          );
                          setShown(null);
                          window.setTimeout(load, 800);
                        }}
                      >
                        Restore this version
                      </button>
                    ) : null}
                    {r.thread ? (
                      <button
                        type="button"
                        className="think-more"
                        onClick={() => {
                          if (r.thread) onThread(r.thread);
                        }}
                      >
                        Open its thread
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/**
 * A thread's change set (9.3): one bar at the foot of the chat, with every
 * edit it proposes now counted; each edit has its own card above, and Use all
 * uses every one (9.4). With "as they land" on, what is left here is what
 * clashed with typing.
 */
export function ChangeSet({
  thread,
  writable,
  autoApply,
}: {
  thread: ThreadView;
  writable: boolean;
  autoApply: boolean;
}) {
  const set = thread.changeSet ?? [];
  const count = set.reduce((n, d) => n + d.sections.length, 0);
  // Saving can take a moment (an offloaded iCloud file waits on its download): say so at once.
  const [using, setUsing] = useState(false);
  useEffect(() => {
    const done = (e: Event) => {
      if ((e as CustomEvent<{ thread: string }>).detail.thread === thread.id) setUsing(false);
    };
    window.addEventListener("anur:use-all-done", done);
    return () => {
      window.removeEventListener("anur:use-all-done", done);
    };
  }, [thread.id]);
  // No page took it (none open): the button comes back rather than stay waiting.
  useEffect(() => {
    if (!using) return;
    const t = setTimeout(() => {
      setUsing(false);
    }, 60_000);
    return () => {
      clearTimeout(t);
    };
  }, [using]);
  if (count < 2) return null;
  const docs = set.map((d) => d.doc.replace(/\.md$/i, "")).join(", ");
  return (
    <div className="think-changeset" role="group" aria-label="Edits from this thread">
      <div className="think-changeset-text">
        <strong>{autoApply ? `${countOf(count, "edit")} kept` : countOf(count, "edit")}</strong>
        {autoApply ? " as proposals" : ` in ${docs}`}
        <span className="quiet">
          {autoApply ? "Their sections changed" : "Not in the docs yet"}
        </span>
      </div>
      {writable ? (
        <button
          type="button"
          className="think-button primary"
          disabled={using}
          onClick={() => {
            setUsing(true);
            window.dispatchEvent(
              new CustomEvent("anur:use-all", { detail: { thread: thread.id } }),
            );
          }}
        >
          {using ? "Using…" : `Use all ${String(count)}`}
        </button>
      ) : null}
    </div>
  );
}
