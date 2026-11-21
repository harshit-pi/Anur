/**
 * A doc's threads and permission prompts, kept current from main's events.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ThreadView } from "../../../shared/ipc-contract.ts";
import { anur } from "../bridge.ts";
import { type Prompt } from "./think-parts.tsx";
import { withEvent } from "./thread-events.ts";

/** The doc's threads, kept current from main's events. */
export function useThreads(docPath: string | null, docText: () => string) {
  const [threads, setThreads] = useState<ThreadView[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  /** The doc whose list has come back; until then the panel says it's loading, not that there are none. */
  const [listed, setListed] = useState<string | null>(null);
  const textNow = useRef(docText);
  textNow.current = docText;

  const [loads, setLoads] = useState(0);
  const shownDoc = useRef<string | null>(null);
  /** Read the list again, after threads moved or went (group 11). */
  const reload = useCallback(() => {
    setLoads((n) => n + 1);
  }, []);
  useEffect(() => {
    if (shownDoc.current !== docPath) {
      shownDoc.current = docPath;
      setThreads([]);
      setPrompts([]);
    }
    if (!docPath) return;
    let current = true;
    void anur.call("thread:list", { path: docPath, text: textNow.current() }).then((r) => {
      if (!current) return;
      setThreads(r.threads);
      setListed(docPath);
    });
    const off = anur.on("thread:event", (e) => {
      if (e.kind === "thread") {
        if (e.path !== docPath) return;
        setThreads((ts) => [...ts.filter((t) => t.id !== e.thread.id), e.thread]);
        if (!e.thread.busy) setPrompts((ps) => ps.filter((p) => p.thread !== e.thread.id));
        return;
      }
      if (e.kind === "permission") {
        setPrompts((ps) => [...ps, e]);
        return;
      }
      setThreads((ts) =>
        ts.map((t) => (t.id === e.thread ? { ...t, busy: true, items: withEvent(t.items, e) } : t)),
      );
    });
    return () => {
      current = false;
      off();
    };
  }, [docPath, loads]);

  return { threads, setThreads, prompts, setPrompts, reload, loading: listed !== docPath };
}
