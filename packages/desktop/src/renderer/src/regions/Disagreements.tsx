/**
 * Decisions that disagree, shown in Think for the person to settle.
 */

export type Disputable = {
  id: string;
  thread: string;
  claim: string;
  quote?: string | null | undefined;
  who?: string | null | undefined;
  at?: string | undefined;
  section: string;
  home?: string | undefined;
  disputed?: { id: string; thread: string; home?: string | undefined } | null | undefined;
};

/**
 * Decisions here that disagree (18.4, 29.9): each pair in full, in the
 * people's own words, and neither holds until someone keeps one; the other
 * is dropped, and history keeps both.
 */
export function Disagreements({
  findings,
  writable,
  onPick,
}: {
  findings: readonly Disputable[];
  writable: boolean;
  onPick: (keep: Disputable, drop: Disputable) => void;
}) {
  const seen = new Set<string>();
  const pairs: [Disputable, Disputable][] = [];
  for (const f of findings) {
    const other = f.disputed ? findings.find((x) => x.id === f.disputed?.id) : undefined;
    if (!other || seen.has(f.id) || seen.has(other.id)) continue;
    seen.add(f.id);
    seen.add(other.id);
    pairs.push((f.at ?? "") <= (other.at ?? "") ? [f, other] : [other, f]);
  }
  if (!pairs.length) return null;
  const when = (at: string | undefined) =>
    at ? new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : null;
  return (
    <>
      {pairs.map(([a, b]) => (
        <div
          key={`${a.id}:${b.id}`}
          className="think-disagree"
          role="group"
          aria-label="Decisions that disagree"
        >
          <span className="think-disagree-tag">These disagree · neither holds yet</span>
          {[a, b].map((d) => (
            <div key={d.id} className="think-disagree-side">
              <div className="think-disagree-words">“{d.quote ?? d.claim}”</div>
              <div className="quiet">
                {/* A name shows only on someone else's; one's own reads "You". */}
                {[d.who ?? "You", when(d.at), d.section].filter(Boolean).join(" · ")}
              </div>
              {writable ? (
                <button
                  type="button"
                  className="think-more"
                  title="Keep this one; the other is dropped, and history keeps both"
                  onClick={() => {
                    onPick(d, d === a ? b : a);
                  }}
                >
                  Keep this one
                </button>
              ) : null}
            </div>
          ))}
          <p className="quiet think-disagree-note">
            The one not kept is dropped. History keeps both.
          </p>
        </div>
      ))}
    </>
  );
}
