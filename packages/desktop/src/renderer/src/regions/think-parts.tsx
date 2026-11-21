/**
 * Small pieces Think's cards and rows share: counts, icons, a file's card, and the permission prompt's type.
 */
import type { EventPayload } from "../../../shared/ipc-contract.ts";
import { anur } from "../bridge.ts";

export type Prompt = EventPayload<"thread:event"> & { kind: "permission" };

export const countOf = (n: number, noun: string) => `${String(n)} ${noun}${n === 1 ? "" : "s"}`;

/** A file or folder waiting in the composer, sent with the next message (10.4). */
export type Attachment = { path: string; name: string };

/** A message waiting for the agent to finish, with the files attached when it was queued. */
export type Queued = { id: number; text: string; files: Attachment[] };

/** The icons under a reply and on a queued message. */
export function Icon({ name }: { name: "copy" | "copied" | "branch" | "use" | "edit" | "close" }) {
  const d = {
    copy: "M10.5 5V3.6A1.6 1.6 0 0 0 8.9 2H3.6A1.6 1.6 0 0 0 2 3.6v5.3A1.6 1.6 0 0 0 3.6 10.5H5M6.6 5h5.3A1.6 1.6 0 0 1 13.5 6.6v5.3a1.6 1.6 0 0 1-1.6 1.6H6.6A1.6 1.6 0 0 1 5 11.9V6.6A1.6 1.6 0 0 1 6.6 5Z",
    copied: "M3 8.5 6.5 12 13 4.5",
    branch:
      "M4.5 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm0 0v6m0 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm7-4a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm0 0c0 2.5-2 3-5.5 4.2",
    use: "M9.5 2H4.2A1.2 1.2 0 0 0 3 3.2v9.6A1.2 1.2 0 0 0 4.2 14h7.6a1.2 1.2 0 0 0 1.2-1.2V5.5L9.5 2ZM8 7v4.5M5.8 9.3 8 11.5l2.2-2.2",
    edit: "M10.8 2.7a1.6 1.6 0 0 1 2.3 2.3L6 12.1 3 13l.9-3 6.9-7.3Z",
    close: "M4 4l8 8M12 4l-8 8",
  }[name];
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Open a file a thread used: a doc or an image in Anur, anything else in its own app. */
export function openFile(rel: string) {
  if (/\.(md|markdown)$/i.test(rel) || /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(rel))
    window.dispatchEvent(new CustomEvent("anur:open-path", { detail: { path: rel } }));
  else void anur.call("doc:reveal", { path: rel, how: "default-app" });
}

/** A file as a card: its type, its name; a folder says so (10.4). */
export function FileCard({
  path,
  onOpen,
  onRemove,
}: {
  path: string;
  onOpen?: () => void;
  onRemove?: () => void;
}) {
  const name = path.split("/").pop() ?? path;
  const ext = /\.([a-z0-9]{1,5})$/i.exec(name)?.[1]?.toUpperCase() ?? "";
  return (
    <span className="file-card" title={path}>
      <span className={`file-card-type${ext ? "" : " folder"}`} aria-hidden="true">
        {ext || (
          <svg width="14" height="14" viewBox="0 0 16 16">
            <path
              d="M1.75 4.25a1 1 0 0 1 1-1h3.1l1.4 1.5h5.99a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
            />
          </svg>
        )}
      </span>
      {onOpen ? (
        <button type="button" className="file-card-name truncate" onClick={onOpen}>
          {name}
        </button>
      ) : (
        <span className="file-card-name truncate">{name}</span>
      )}
      {onRemove ? (
        <button
          type="button"
          className="file-card-x"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}
