/**
 * Choosing which agent a thread talks to, its options, and signing in to one.
 */
import type { AgentSignIn, SessionOption, ThreadView } from "../../../shared/ipc-contract.ts";
import { AGENTS, type AgentId } from "../../../shared/agents.ts";
import { anur } from "../bridge.ts";
import { AGENT_SHORT, AgentMark } from "./AgentMark.tsx";

/** The agent that ran an item's turn; the thread's own when the turn didn't say. */
export const turnAgent = (t: ThreadView, item: ThreadView["items"][number]): AgentId =>
  ("turn" in item ? t.turnAgents?.[item.turn] : undefined) ?? t.agent;

/** Settings → Agents, where agents are switched on and off. */
export const openAgents = () => {
  window.dispatchEvent(new CustomEvent("anur:open-settings", { detail: { section: "agent" } }));
};

/**
 * Which agent a thread runs on, among those switched on. With one agent on
 * there's nothing to pick, so it isn't shown; the menu ends in More agents….
 */
export function AgentPicker({
  value,
  agents,
  disabled,
  onChange,
}: {
  value: AgentId;
  agents: readonly AgentId[];
  disabled: boolean;
  onChange: (agent: AgentId) => void;
}) {
  // A thread on an agent since switched off still names it.
  const shown = agents.includes(value) ? agents : [value, ...agents];
  if (shown.length <= 1) return null;
  return (
    <label className="think-option">
      <span className="think-pick" title={AGENTS[value].name}>
        <AgentMark agent={value} />
        {AGENT_SHORT[value]}
      </span>
      <select
        aria-label="Agent"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value === MORE) {
            openAgents();
            return;
          }
          const next = shown.find((id) => id === e.target.value);
          if (next) onChange(next);
        }}
      >
        {shown.map((id) => (
          <option key={id} value={id}>
            {AGENTS[id].name}
          </option>
        ))}
        <option value={MORE}>More agents…</option>
      </select>
    </label>
  );
}

export const MORE = "__more_agents";

/** Newly read choices, keeping what the person already picked where it is still offered. */
export function withPicks(fresh: SessionOption[], now: SessionOption[]): SessionOption[] {
  return fresh.map((o) => {
    const picked = now.find((x) => x.id === o.id)?.current;
    return picked && o.choices.some((c) => c.value === picked) ? { ...o, current: picked } : o;
  });
}

/** One of the agent's own choices for a session, such as its mode or model. */
export function OptionPicker({
  option,
  disabled,
  onChange,
  onMore = null,
}: {
  option: SessionOption;
  disabled: boolean;
  onChange: (value: string) => void;
  /** A last item that opens Settings → Agents, when no agent menu is shown. */
  onMore?: (() => void) | null;
}) {
  return (
    <label className="think-option">
      <span className="think-pick">
        {option.choices.find((c) => c.value === option.current)?.name ?? option.current}
      </span>
      <select
        aria-label={option.name}
        value={option.current}
        disabled={disabled}
        title={option.choices.find((c) => c.value === option.current)?.description ?? undefined}
        onChange={(e) => {
          if (e.target.value === MORE) {
            onMore?.();
            return;
          }
          onChange(e.target.value);
        }}
      >
        {option.choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.name}
          </option>
        ))}
        {onMore ? <option value={MORE}>More agents…</option> : null}
      </select>
    </label>
  );
}

/**
 * The agent isn't signed in: its own sign-ins, each run by Anur without a
 * terminal (3.16). The sign-in opens in the browser; once it's done, the
 * agent restarts and this goes away.
 */
export function SignInCard({ e }: { e: AgentSignIn }) {
  const name = AGENTS[e.agent].name;
  const waiting = e.signIn?.phase === "waiting";
  return (
    <div className="think-signin" role="group" aria-label={`Sign in to ${name}`}>
      <p className="think-signin-title">{name} isn't signed in</p>
      {waiting ? (
        <>
          <p className="quiet">Finish signing in in your browser. This updates when you're done.</p>
          <div className="think-signin-actions">
            {e.signIn?.url ? (
              <button
                type="button"
                className="think-button"
                onClick={() => {
                  void anur.call("link:open-external", { url: e.signIn?.url ?? "" });
                }}
              >
                Open the sign-in page again
              </button>
            ) : null}
            <button
              type="button"
              className="think-button"
              onClick={() => {
                void anur.call("agent:sign-in-cancel", { agent: e.agent });
              }}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="quiet">
            Threads run on your own {name} account. Sign in once here; it's the same sign-in as in
            your terminal.
          </p>
          {e.signIn?.phase === "failed" && e.signIn.message ? (
            <p className="think-error">{e.signIn.message}</p>
          ) : null}
          <div className="think-signin-actions">
            {e.auth.methods.map((m, i) => (
              <button
                key={m.id}
                type="button"
                className={`think-button${i === 0 ? " primary" : ""}`}
                title={m.description ?? undefined}
                onClick={() => {
                  void anur.call("agent:sign-in", { agent: e.agent, method: m.id });
                }}
              >
                {signInLabel(m.name)}
              </button>
            ))}
          </div>
          {e.auth.methods.length === 0 ? (
            <p className="quiet">
              Sign in from a terminal with <code>claude</code>, then come back.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/** A sign-in's button: what it is, in plain words. */
export const signInLabel = (name: string) =>
  /subscription/i.test(name)
    ? "Sign in with your Claude account"
    : /console/i.test(name)
      ? "Use an Anthropic Console account"
      : `Sign in: ${name}`;
