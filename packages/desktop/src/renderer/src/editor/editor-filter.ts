import { EditorState, Transaction } from "@codemirror/state";

/**
 * The editor filter (task 2.16, Architecture "Who writes the file"). A change
 * reaches the document only when it is tagged as one of Anur's kinds:
 * typing (with paste, drop, input methods, find and replace, and every
 * command and widget edit, all tagged "input…"), deleting, undo and redo,
 * moving lines, an outside change, and, later, Apply and Restore and a
 * teammate's live edit. Anything else, such as an extension or a stray
 * dispatch with no tag, is dropped, so nothing changes decided text by
 * accident.
 */

const KINDS = ["input", "delete", "undo", "redo", "move", "outside", "apply", "restore"];

/** Whether a transaction's changes may reach the document. */
export function allowedChange(tr: Transaction): boolean {
  if (!tr.docChanged) return true;
  return KINDS.some((kind) => tr.isUserEvent(kind));
}

export const editorFilter = EditorState.changeFilter.of((tr) => {
  if (allowedChange(tr)) return true;
  // A missing tag is a bug to fix, not a change to let through.
  if (import.meta.env.DEV) {
    console.warn(
      "Anur dropped an untagged change to the doc",
      tr.annotation(Transaction.userEvent),
    );
  }
  return false;
});
