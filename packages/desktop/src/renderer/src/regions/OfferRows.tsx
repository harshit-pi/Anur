/**
 * Rows Think shows for what a thread offers: an option's text, a proposed edit, and a changed page.
 */
import { useState, type ReactNode } from "react";
import { withoutHeading } from "@anur/core";
import { Markdown } from "./Markdown.tsx";

/**
 * A page a thread changed, in one line: its name opens it, then the sections
 * touched and whether it is waiting or was taken back, then its button.
 */
export function ChangeRow({
  doc,
  sections,
  state,
  children,
}: {
  doc: string;
  sections: readonly (readonly string[])[];
  state: "waiting" | "taken back" | null;
  children: ReactNode;
}) {
  const name = (doc.split("/").pop() ?? doc).replace(/\.md$/i, "");
  // A change with no section found is named by its file alone.
  const where = sections.map((p) => p.at(-1) ?? "").filter((x) => x && x !== doc);
  return (
    <div className="think-changed auto compact" role="status" title={doc}>
      <span>
        <button
          type="button"
          className="think-link"
          onClick={() => {
            window.dispatchEvent(new CustomEvent("anur:open-path", { detail: { path: doc } }));
          }}
        >
          {name}
        </button>
        <span className="quiet">
          {[where.join(", "), state].filter(Boolean).map((x) => ` · ${String(x)}`)}
        </span>
      </span>
      {children}
    </div>
  );
}

/** The text of a proposed edit, without its section's own heading line. */
export function proposedBody(part: { proposed: string }): string {
  return withoutHeading(part.proposed).trim();
}

/**
 * An edit a thread made to a section, shown like an option: what the section
 * would say, and Use this. The page shows the same edit in place.
 */
/**
 * A choice card's text, cut short with a fade. It opens when clicked, never on hover:
 * hovering used to open it and push Use and Explore this down from
 * under the pointer, so the first click missed (30.30).
 */
export function OfferText({
  children,
  open,
  onToggle,
}: {
  children: React.ReactNode;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={`think-offer-text${open ? " open" : ""}`}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      title={open ? "Show less" : "Show all"}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      {children}
    </div>
  );
}

export function EditCard({
  part,
  writable,
  onUse,
  onShow,
  onDrop,
}: {
  part: { path: string[]; proposed: string };
  writable: boolean;
  onUse: () => void;
  onShow: () => void;
  onDrop: () => void;
}) {
  const body = proposedBody(part);
  const [textOpen, setTextOpen] = useState(false);
  return (
    <div
      className="think-offer edit"
      role="group"
      aria-label={`Proposed edit to ${part.path.at(-1) ?? ""}`}
    >
      <div className="think-offer-head">
        <strong>± Edit {part.path.at(-1)}</strong>
        <span className="quiet">Not in the doc yet</span>
      </div>
      <OfferText
        open={textOpen}
        onToggle={() => {
          setTextOpen((v) => !v);
        }}
      >
        {body ? <Markdown text={body} /> : <p className="quiet">Removes the section's text.</p>}
      </OfferText>
      <div className="think-offer-actions">
        {writable ? (
          <button type="button" className="think-button primary" onClick={onUse}>
            Use
          </button>
        ) : null}
        <button type="button" className="think-more" onClick={onShow}>
          Show on page
        </button>
        {writable ? (
          <button type="button" className="think-more" onClick={onDrop}>
            Set aside
          </button>
        ) : null}
      </div>
    </div>
  );
}
