import { useCallback, useEffect, useState } from "react";
import { anur } from "../bridge.ts";
import {
  citeOf,
  labelOf,
  moreSummary,
  placeOf,
  reportItems,
  taskTitle,
  type ReportItem,
  type TaskReport,
} from "../layout/task-report.ts";

const plural = (n: number, one: string) => `${String(n)} ${n === 1 ? one : `${one}s`}`;

/** When a task ended, in the person's words: "Nov 17, 16:40". */
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
};

/** Text with `code` spans, as Claude writes its choices. */
function WithCode({ text }: { text: string }) {
  return <>{text.split("`").map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part))}</>;
}

function Item({ item }: { item: ReportItem }) {
  if (item.kind === "choice")
    return (
      <div className="report-row">
        <span className="report-label choice">{labelOf(item)}</span>
        <span className="report-what choice">
          <WithCode text={item.text} />
        </span>
        <span className="report-cite" />
      </div>
    );
  const l = item.line;
  const how = l.how === "added" ? " · new file" : l.how === "deleted" ? " · deleted" : "";
  return (
    <div className="report-row">
      <span className={`report-label ${l.category}`}>{labelOf(item)}</span>
      <span className="report-what">
        {placeOf(l)}
        <span className="report-how">{how}</span>
        {l.calls?.length ? (
          <span className="report-calls">
            ─▶ {l.calls.slice(0, 2).join(", ")}
            {l.calls.length > 2 ? ` and ${String(l.calls.length - 2)} more` : ""}
          </span>
        ) : null}
        {l.text ? <code className="report-text">{l.text}</code> : null}
      </span>
      <span className="report-cite">{citeOf(l)}</span>
    </div>
  );
}

type Against = NonNullable<TaskReport["against"]>[number];

/**
 * A change that goes against a decision (24.1), first in the report: the
 * decision in the people's words, who made it, why the change goes against
 * it, and where. One the agent wasn't sure of is a question for the person.
 */
function AgainstRow({
  a,
  onAnswer,
}: {
  a: Against;
  onAnswer: (answer: "does" | "doesnt") => void;
}) {
  const made = when(a.at).split(",")[0] ?? "";
  const cite = a.file ? (a.line ? `${a.file}:${String(a.line)}` : a.file) : "";
  const asked = a.status === "asked";
  return (
    <div className={`report-row against${asked ? " asked" : ""}`}>
      <span className="report-label against">{asked ? "Against?" : "Against"}</span>
      <span className="report-what">
        “{a.decision}” <span className="quiet">{[a.who, made].filter(Boolean).join(", ")}</span>
        {a.why ? <span className="report-why">{a.why}</span> : null}
        {asked ? (
          <span className="report-ask">
            Does the change go against it?{" "}
            <button
              type="button"
              className="system-inline"
              onClick={() => {
                onAnswer("does");
              }}
            >
              It does
            </button>{" "}
            <button
              type="button"
              className="system-inline"
              onClick={() => {
                onAnswer("doesnt");
              }}
            >
              It doesn't
            </button>
          </span>
        ) : null}
      </span>
      <span className="report-cite">{cite}</span>
    </div>
  );
}

/**
 * A task's change report (21.3, 21.4): at most three lines before "more",
 * ranked data, auth, calls, Claude's choices, UI, other, each citing its
 * file and line. It shows whether or not any decisions exist.
 */
export function TaskView({ id, onSystem }: { id: string; onSystem: () => void }) {
  const [report, setReport] = useState<TaskReport | null | "reading">("reading");
  const [more, setMore] = useState(false);
  const read = useCallback(() => {
    void anur.call("tasks:get", { id }).then((r) => {
      setReport(r.report);
    });
  }, [id]);
  useEffect(() => {
    read();
    setMore(false);
  }, [read]);
  // The check against decisions lands after the report shows (24.1).
  useEffect(() => anur.on("tasks:changed", read), [read]);

  if (report === "reading") return <div className="task-view quiet">Reading the report…</div>;
  if (!report)
    return (
      <div className="task-view">
        <p className="quiet">This report is gone from the folder's .anur/tasks.</p>
      </div>
    );
  const items = reportItems(report);
  const top = items.slice(0, 3);
  const rest = items.slice(3);
  const files = new Set(report.lines.map((l) => l.file)).size;
  return (
    <div className="task-view">
      <h1 className="task-title">{taskTitle(report)}</h1>
      <p className="task-meta">
        Task done · {when(report.endedAt)} · {plural(report.repos.length, "repo")} ·{" "}
        {plural(files, "file")}
      </p>
      <div className="report">
        {(report.against ?? [])
          .filter((a) => a.status !== "dismissed")
          .map((a) => (
            <AgainstRow
              key={a.target}
              a={a}
              onAnswer={(answer) => {
                void anur.call("tasks:against", { id, target: a.target, answer }).then(read);
              }}
            />
          ))}
        {(more ? items : top).map((it, i) => (
          <Item key={i} item={it} />
        ))}
      </div>
      {report.against === undefined && Date.now() - Date.parse(report.endedAt) < 2 * 3600_000 ? (
        <p className="quiet task-checking">Checking the change against what people decided…</p>
      ) : null}
      {rest.length ? (
        <button
          type="button"
          className="report-more"
          aria-expanded={more}
          onClick={() => {
            setMore((m) => !m);
          }}
        >
          {more ? "Less ▴" : `${String(rest.length)} more ▾`}
          {more ? null : <span className="quiet"> {moreSummary(rest)}</span>}
        </button>
      ) : null}
      <p className="task-foot quiet">
        Repos: {report.repos.map((r) => r.dir).join(", ")}.{" "}
        <button type="button" className="system-inline" onClick={onSystem}>
          Open the system
        </button>
      </p>
    </div>
  );
}
