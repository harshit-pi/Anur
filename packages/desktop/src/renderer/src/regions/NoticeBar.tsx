import type { ReactNode } from "react";
import { CloseIcon } from "./Icons.tsx";

/** The one bar above the page: info or warn, optional actions, and a close icon. */
export function NoticeBar({
  tone,
  children,
  actions,
  onClose,
  closeTitle = "Close",
}: {
  tone: "info" | "warn";
  children: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  closeTitle?: string;
}) {
  return (
    <div className={`notice-bar ${tone}`} role={tone === "warn" ? "alert" : "status"}>
      <span className="notice-bar-text">{children}</span>
      <span className="notice-bar-actions">
        {actions}
        <button
          type="button"
          className="icon-button"
          aria-label="Close"
          title={closeTitle}
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </span>
    </div>
  );
}
