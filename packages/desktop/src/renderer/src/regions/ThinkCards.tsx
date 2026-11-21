/**
 * Cards a thread shows in Think: a check of the section, a finding, a decision, a plan.
 */
import { useState } from "react";
import { anur } from "../bridge.ts";
import { Markdown } from "./Markdown.tsx";
import { countOf, type Prompt } from "./think-parts.tsx";

export const VERDICT: Record<"holds" | "wrong" | "unsupported" | "missing", string> = {
  holds: "Holds",
  wrong: "Wrong",
  unsupported: "Unsupported",
  missing: "Missing",
};

/** A check's report: each claim with what it was tested against. */
export function CheckCard({
  claims,
  corrected,
  onKeep,
}: {
  /** Keep what a wrong or missing claim's source says as a finding (16.2). */
  onKeep: ((claim: string, source: string | null) => void) | null;
  claims: {
    claim: string;
    verdict: keyof typeof VERDICT;
    source: string;
    note: string;
    about?: "fact" | "wording" | undefined;
  }[];
  corrected: boolean;
}) {
  const [kept, setKept] = useState<Set<number>>(new Set());
  // What needs a look first, in this order; what holds folds away.
  const order = ["wrong", "missing", "unsupported"] as const;
  const problems = order.flatMap((v) => claims.filter((c) => c.verdict === v));
  const fine = claims.filter((c) => c.verdict === "holds");
  const said = order
    .map((v) => [v, claims.filter((c) => c.verdict === v).length] as const)
    .filter(([, n]) => n > 0)
    .map(
      ([v, n]) =>
        `${String(n)} ${n === 1 ? "is" : "are"} ${v === "unsupported" ? "unsupported" : v}`,
    );
  const row = (c: (typeof claims)[number], i: number) => (
    <li key={i} className={`think-claim ${c.verdict}`}>
      <div className="think-claim-line">
        <span className="think-verdict">{VERDICT[c.verdict]}</span>
        <span>{c.claim}</span>
      </div>
      <div className="quiet think-claim-note">
        {c.note}{" "}
        <span className="think-source" title={c.source}>
          source
        </span>
        {/* Only a fact is worth carrying to new threads, not a typo (17.3). */}
        {onKeep && (c.verdict === "wrong" || c.verdict === "missing") && c.about !== "wording" ? (
          kept.has(claims.indexOf(c)) ? (
            <span className="think-kept"> · kept as a finding</span>
          ) : (
            <>
              {" · "}
              <button
                type="button"
                className="think-link"
                title="New threads on this section will know it, with its source"
                onClick={() => {
                  onKeep(c.note, c.source || null);
                  setKept((k) => new Set(k).add(claims.indexOf(c)));
                }}
              >
                Keep as a finding
              </button>
            </>
          )
        ) : null}
      </div>
    </li>
  );
  return (
    <div className="think-check" role="group" aria-label="Check">
      <p className="think-check-head">
        <strong>
          {problems.length === 0
            ? `All ${countOf(claims.length, "claim")} hold`
            : `Of ${countOf(claims.length, "claim")}, ${said.join(", ")}`}
        </strong>
      </p>
      {problems.length > 0 ? <ul>{problems.map(row)}</ul> : null}
      {fine.length > 0 && problems.length > 0 ? (
        <details className="think-check-fine">
          <summary className="quiet">{countOf(fine.length, "claim")} hold</summary>
          <ul>{fine.map(row)}</ul>
        </details>
      ) : null}
      {corrected ? (
        <button
          type="button"
          className="think-link think-check-fix"
          onClick={() => {
            document
              .querySelector(".think-offer.edit")
              ?.scrollIntoView({ block: "center", behavior: "smooth" });
          }}
        >
          The corrected text is ready to use, below
        </button>
      ) : null}
    </div>
  );
}

/**
 * A finding the agent proposed (16.1): keep it, reworded if needed, or drop
 * it. Kept, it reaches every new thread on this section, with its source.
 */
export function FindingCard({
  item,
  thread,
  writable,
}: {
  item: {
    id: string;
    claim: string;
    source: string | null;
    status: "proposed" | "kept" | "dropped";
    scope?: Scope | undefined;
    by?: "person" | undefined;
    quote?: string | null | undefined;
    instead?: string | null | undefined;
    until?: string | null | undefined;
    who?: string | null | undefined;
    auto?: boolean | undefined;
  };
  thread: string;
  writable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.claim);
  const decide = (status: "kept" | "dropped", claim: string | null = null, scope?: Scope) => {
    setEditing(false);
    void anur.call("finding:decide", {
      thread,
      id: item.id,
      status,
      claim,
      ...(scope ? { scope } : {}),
    });
  };
  if (item.by === "person") return <DecisionCard item={item} writable={writable} decide={decide} />;
  if (item.status !== "proposed")
    return (
      <div className={`think-finding ${item.status}`} role="status">
        <span className="think-finding-label">
          {item.status === "kept" ? "Finding kept" : "Finding dropped"}
        </span>{" "}
        {item.claim}
        {item.source ? <span className="quiet"> · {item.source}</span> : null}
      </div>
    );
  return (
    <div className="think-finding proposed" role="group" aria-label="Finding">
      <div className="think-finding-label">Finding</div>
      {editing ? (
        <textarea
          className="think-input think-finding-edit"
          value={text}
          rows={2}
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
      ) : (
        <div>{item.claim}</div>
      )}
      {item.source ? <div className="quiet think-claim-note">From {item.source}</div> : null}
      {writable ? (
        <div className="think-offer-actions">
          <button
            type="button"
            className="think-button primary"
            title="New threads on this section will know it"
            onClick={() => {
              decide("kept", editing && text.trim() !== item.claim ? text : null);
            }}
          >
            Keep
          </button>
          {editing ? null : (
            <button
              type="button"
              className="think-more"
              onClick={() => {
                setEditing(true);
              }}
            >
              Edit
            </button>
          )}
          <button
            type="button"
            className="think-more"
            onClick={() => {
              decide("dropped");
            }}
          >
            Drop
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** How far a decision reaches (18.3): set from the person's words, never picked here. */
export type Scope = "section" | "doc" | "folder" | "everywhere";

/**
 * A decision a person made, in their words. Settled by itself, it's one
 * quiet line with Undo; when the agent was unsure, or the words were a
 * question, it asks once: keep it for later work, or just this once.
 */
export function DecisionCard({
  item,
  writable,
  decide,
}: {
  item: {
    claim: string;
    status: "proposed" | "kept" | "dropped";
    scope?: Scope | undefined;
    quote?: string | null | undefined;
    instead?: string | null | undefined;
    until?: string | null | undefined;
    who?: string | null | undefined;
    auto?: boolean | undefined;
  };
  writable: boolean;
  decide: (status: "kept" | "dropped", claim?: string | null, scope?: Scope) => void;
}) {
  const said = item.who ? `${item.who}: ` : "";
  const extra = [
    item.instead ? `instead of ${item.instead}` : null,
    item.until ? `until ${item.until}` : null,
  ].filter(Boolean);
  if (item.status !== "proposed")
    return (
      <div
        className={`think-decided${item.status === "dropped" ? " undone" : ""}`}
        role="status"
        title={item.quote ? `${said}“${item.quote}”` : undefined}
      >
        <span className="think-decided-mark" aria-hidden="true">
          {item.status === "dropped" ? "·" : "✓"}
        </span>
        <span>
          {item.status === "dropped" ? "Not kept: " : "Decided: "}
          {item.claim}
          {extra.length ? <span className="quiet"> ({extra.join(", ")})</span> : null}
          {item.who ? <span className="quiet"> · {item.who}</span> : null}
        </span>
        {writable && item.status === "kept" && item.auto ? (
          <button
            type="button"
            className="think-more"
            title="It won't reach new threads"
            onClick={() => {
              decide("dropped");
            }}
          >
            Undo
          </button>
        ) : null}
      </div>
    );
  return (
    <div className="think-finding proposed" role="group" aria-label="Decision">
      <div className="think-finding-label">Keep this for later work?</div>
      {item.quote ? (
        <div className="think-decided-quote">
          {said}“{item.quote}”
        </div>
      ) : null}
      <div>{item.claim}</div>
      {extra.length ? <div className="quiet think-claim-note">{extra.join(" · ")}</div> : null}
      {writable ? (
        <div className="think-offer-actions">
          <button
            type="button"
            className="think-button primary"
            title="New threads where it applies will follow it"
            onClick={() => {
              decide("kept", null, item.scope);
            }}
          >
            Keep
          </button>
          <button
            type="button"
            className="think-more"
            onClick={() => {
              decide("dropped");
            }}
          >
            Just this once
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** The plan an agent wants approved before it acts. */
export function PlanCard({
  plan,
  build,
  options,
  onPick,
}: {
  plan: string;
  build: boolean;
  options: Prompt["options"];
  onPick: (o: Prompt["options"][number]) => void;
}) {
  const allow =
    options.find((o) => o.kind === "allow_once") ?? options.find((o) => o.kind.startsWith("allow"));
  const reject = options.find((o) => o.kind.startsWith("reject"));
  return (
    <div className="think-plan" role="group" aria-label="Plan">
      <p className="think-plan-head">
        <strong>{build ? "The plan, before it builds" : "The plan, before it acts"}</strong>
        <span className="quiet"> · nothing has changed yet</span>
      </p>
      <div className="think-plan-text">
        <Markdown text={plan} />
      </div>
      <div className="think-ask-options">
        {allow ? (
          <button
            type="button"
            className="think-button primary"
            onClick={() => {
              onPick(allow);
            }}
          >
            {build ? "Approve and build" : "Approve and run"}
          </button>
        ) : null}
        {reject ? (
          <button
            type="button"
            className="think-more"
            onClick={() => {
              onPick(reject);
            }}
          >
            Keep planning
          </button>
        ) : null}
      </div>
    </div>
  );
}
