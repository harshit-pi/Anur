import { EditorSelection, type ChangeSpec, type EditorState } from "@codemirror/state";
import type { Command, EditorView, KeyBinding } from "@codemirror/view";

/**
 * Formatting commands for the page (task 2.8), with the shortcuts Google
 * Docs and Quip use. Each one edits the Markdown text, so the file stays
 * plain Markdown, and each is a single undo step.
 */

/** The lines a selection touches, each once. */
function selectedLines(state: EditorState) {
  const seen = new Set<number>();
  const lines = [];
  for (const r of state.selection.ranges) {
    for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) {
      if (!seen.has(n)) {
        seen.add(n);
        lines.push(state.doc.line(n));
      }
    }
  }
  return lines;
}

const HEADING = /^(#{1,6})[ \t]+/;

/** Turn the selected lines into a heading of `level`, or into body text for 0. */
export function setHeading(level: number): Command {
  return (view) => {
    const changes: ChangeSpec[] = selectedLines(view.state).map((line) => {
      const current = HEADING.exec(line.text);
      const insert = level > 0 ? `${"#".repeat(level)} ` : "";
      return { from: line.from, to: line.from + (current?.[0].length ?? 0), insert };
    });
    view.dispatch({ changes, userEvent: "input.format", scrollIntoView: true });
    return true;
  };
}

/** Wrap or unwrap the selection in a mark such as "**"; with nothing selected, leave the cursor between the marks. */
export function toggleMark(mark: string): Command {
  return (view) => {
    const { state } = view;
    const n = mark.length;
    view.dispatch(
      state.changeByRange((r) => {
        const before = state.sliceDoc(r.from - n, r.from);
        const after = state.sliceDoc(r.to, r.to + n);
        if (before === mark && after === mark) {
          return {
            changes: [
              { from: r.from - n, to: r.from },
              { from: r.to, to: r.to + n },
            ],
            range: EditorSelection.range(r.from - n, r.to - n),
          };
        }
        const inner = state.sliceDoc(r.from, r.to);
        if (inner.length >= 2 * n && inner.startsWith(mark) && inner.endsWith(mark)) {
          return {
            changes: { from: r.from, to: r.to, insert: inner.slice(n, -n) },
            range: EditorSelection.range(r.from, r.to - 2 * n),
          };
        }
        return {
          changes: [
            { from: r.from, insert: mark },
            { from: r.to, insert: mark },
          ],
          range: EditorSelection.range(r.from + n, r.to + n),
        };
      }),
      { userEvent: "input.format" },
    );
    return true;
  };
}

/** Make the selection a link and put the cursor where the address goes. Needs a selection, so ⌘K with none opens the palette. */
export const insertLink: Command = (view) => {
  const { state } = view;
  if (state.selection.ranges.every((r) => r.empty)) return false;
  view.dispatch(
    state.changeByRange((r) => {
      if (r.empty) return { range: r };
      const text = state.sliceDoc(r.from, r.to);
      const insert = `[${text}]()`;
      return {
        changes: { from: r.from, to: r.to, insert },
        range: EditorSelection.cursor(r.from + insert.length - 1),
      };
    }),
    { userEvent: "input.format" },
  );
  return true;
};

const LIST = /^(\s*)(?:[-*+]|\d+[.)])[ \t]+/;

/** Make the selected lines a bulleted or numbered list, or take them out of it. */
export function toggleList(kind: "bullet" | "number"): Command {
  return (view) => {
    const lines = selectedLines(view.state).filter((l) => l.text.trim() !== "");
    if (lines.length === 0) return false;
    const isKind = (text: string) => {
      const m = LIST.exec(text);
      if (!m) return false;
      const marker = text.slice(m[1]?.length ?? 0).trimStart();
      return kind === "bullet" ? /^[-*+]/.test(marker) : /^\d/.test(marker);
    };
    const remove = lines.every((l) => isKind(l.text));
    const changes: ChangeSpec[] = lines.map((line, i) => {
      const m = LIST.exec(line.text);
      const indent = m?.[1] ?? /^\s*/.exec(line.text)?.[0] ?? "";
      const end = line.from + (m ? m[0].length : indent.length);
      const marker = remove ? "" : kind === "bullet" ? "- " : `${String(i + 1)}. `;
      return { from: line.from + indent.length, to: end, insert: marker };
    });
    view.dispatch({ changes, userEvent: "input.format" });
    return true;
  };
}

/** Tick or untick the task box at `pos`, the start of its "[ ]". */
export function toggleTask(view: EditorView, pos: number): boolean {
  const box = view.state.sliceDoc(pos, pos + 3);
  if (!/^\[[ xX]\]$/.test(box)) return false;
  const insert = box === "[ ]" ? "[x]" : "[ ]";
  view.dispatch({
    changes: { from: pos + 1, to: pos + 2, insert: insert.charAt(1) },
    userEvent: "input.check",
  });
  return true;
}

export const formattingKeymap: KeyBinding[] = [
  ...[0, 1, 2, 3, 4, 5, 6].map((level) => ({
    key: `Mod-Alt-${String(level)}`,
    run: setHeading(level),
  })),
  { key: "Mod-b", run: toggleMark("**") },
  { key: "Mod-i", run: toggleMark("*") },
  { key: "Mod-Shift-x", run: toggleMark("~~") },
  { key: "Mod-k", run: insertLink },
  { key: "Mod-Shift-7", run: toggleList("number") },
  { key: "Mod-Shift-8", run: toggleList("bullet") },
];
