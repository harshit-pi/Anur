/**
 * An agent's turn in a thread: its reply, the steps that led to it, and what it's doing now.
 */
import { ServiceIcon, serviceOf } from "../icons/services/index.tsx";
import { useEffect, useState } from "react";
import type { SessionOption } from "../../../shared/ipc-contract.ts";
import { type AgentId } from "../../../shared/agents.ts";
import { anur } from "../bridge.ts";
import { AGENT_SHORT, AgentMark } from "./AgentMark.tsx";
import { Markdown } from "./Markdown.tsx";
import { stepsSummary, toolLabel, type ToolItem } from "./thread-steps.ts";
import { Icon } from "./think-parts.tsx";

/** While a turn runs: the agent's mark, what it's doing, and for how long, as Claude shows it. */
export function Working({
  agent,
  since,
  doing,
}: {
  agent: AgentId;
  since: number | null;
  doing: string | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(t);
    };
  }, []);
  const secs = since ? Math.max(0, Math.round((now - since) / 1000)) : 0;
  const took =
    secs < 60 ? `${String(secs)}s` : `${String(Math.floor(secs / 60))}m ${String(secs % 60)}s`;
  return (
    <div className="think-working" role="status">
      <span className="think-working-mark">
        <AgentMark agent={agent} />
      </span>
      <span className="think-working-what">{doing ?? "Thinking…"}</span>
      <span className="think-working-time">{took}</span>
    </div>
  );
}

/**
 * The thread's items, with each run of two or more tool calls gathered into
 * one fold, as Claude's apps show them: the steps are there, a click away.
 */
/** "Claude · Opus 5.5": the agent, and its model when the session has said. */
export function whoLabel(agent: AgentId, options: SessionOption[]): string {
  const model = options.find((o) => o.id === "model");
  const name = model?.choices.find((c) => c.value === model.current)?.name;
  return name ? `${AGENT_SHORT[agent]} · ${name}` : AGENT_SHORT[agent];
}

/** An agent's reply: who answered (on the first of a turn), the text, and its actions on hover. */
export function AgentReply({
  text,
  who,
  onBranch,
  onUse,
  after = null,
}: {
  text: string;
  who: { agent: AgentId; label: string } | null;
  onBranch: (() => void) | null;
  onUse: (() => void) | null;
  /** Under the reply's actions: what this answer made, when its cards follow (answer first). */
  after?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="think-reply">
      {who ? (
        <div className="think-who">
          <AgentMark agent={who.agent} />
          {who.label}
        </div>
      ) : null}
      {/* Always whole, as in Claude chat: a reply grows on screen as it streams. */}
      <div className="think-message agent">
        <Markdown text={text} />
      </div>
      <div className="think-reply-actions">
        <button
          type="button"
          aria-label={copied ? "Copied" : "Copy"}
          title={copied ? "Copied" : "Copy"}
          onClick={() => {
            void anur.call("clipboard:write", { text }).then(() => {
              setCopied(true);
              setTimeout(() => {
                setCopied(false);
              }, 1500);
            });
          }}
        >
          <Icon name={copied ? "copied" : "copy"} />
        </button>
        {onBranch ? (
          <button
            type="button"
            aria-label="Branch from here"
            title="Branch from here: a new thread that knows this chat up to this reply"
            onClick={onBranch}
          >
            <Icon name="branch" />
          </button>
        ) : null}
        {onUse ? (
          <button
            type="button"
            aria-label="Use in doc"
            title="Use in doc: add this reply at the end of the thread's section; ⌘Z takes it back"
            onClick={onUse}
          >
            <Icon name="use" />
          </button>
        ) : null}
      </div>
      {after}
    </div>
  );
}

/** A run of tool calls as one line: how many, and what the last few did; open for all of them. */
export function StepsFold({ steps, running }: { steps: ToolItem[]; running: boolean }) {
  // A doc edit Anur sent to the working copy "fails" first, then runs there: not a failure.
  const redirected = (t: ToolItem) =>
    t.status === "failed" &&
    steps.some((x) => {
      const m = /^(\w+) (.+)$/.exec(t.title);
      return m !== null && x.title === `${m[1] ?? ""} working copy of ${m[2] ?? ""}`;
    });
  // While running, the step under way; after, what the run did. A step that
  // failed shows ×, opened: the agent usually recovers, so the summary doesn't say so.
  const last = running
    ? toolLabel(steps.at(-1)?.title ?? "")
    : stepsSummary(steps.filter((t) => !redirected(t)));
  return (
    <details className="think-steps">
      <summary>
        <span className="think-steps-count">
          {String(steps.filter((t) => !redirected(t)).length)} steps{running ? " so far" : ""}
        </span>
        <span className="think-steps-last truncate">{last}</span>
      </summary>
      <div className="think-steps-list">
        {steps.map((t) =>
          redirected(t) ? null : (
            <div key={t.toolUse} className={`think-tool ${t.status}`} title={t.title}>
              {t.status === "failed" ? "× " : ""}
              {serviceOf(t.title) ? <ServiceIcon service={serviceOf(t.title)} /> : null}
              {toolLabel(t.title)}
            </div>
          ),
        )}
      </div>
    </details>
  );
}
