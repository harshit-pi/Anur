import { indentLess, indentMore } from "@codemirror/commands";
import { markdownKeymap } from "@codemirror/lang-markdown";
import type { Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { formattingKeymap } from "./commands.ts";
import { imagePasteDrop, imageSelection } from "./images/image-widget.ts";
import { insertMenu } from "./insert-menu.ts";
import { linkClicks, type ClickedLink } from "./link-click.ts";
import { editLink, linkEditor } from "./link-editor.ts";
import { insertNewlineContinueNumbering } from "./list-numbering.ts";
import { markdownSupport } from "./sections.ts";
import { pageHighlight } from "./theme.ts";

/**
 * How Markdown is typed and clicked, the same wherever a doc's text is edited:
 * the page, a section in Think, a section's hover card on the map. Each adds
 * only its own history, look and keys after this.
 */
export function markdownEditing(o: {
  editable: boolean;
  docs: readonly string[];
  onOpenLink: (link: ClickedLink, inNewTab: boolean) => void;
  notify: (message: string) => void;
}): Extension[] {
  return [
    keymap.of([
      ...(o.editable
        ? [
            { key: "Mod-k", run: editLink },
            { key: "Enter", run: insertNewlineContinueNumbering },
            // Tab nests a line or list item, as in a text editor, instead of leaving the text.
            { key: "Tab", run: indentMore, shift: indentLess },
          ]
        : []),
      ...formattingKeymap,
      ...markdownKeymap,
    ]),
    markdownSupport(),
    pageHighlight,
    ...(o.editable ? [insertMenu(o.docs), linkEditor, imagePasteDrop(o.notify)] : []),
    linkClicks(o.onOpenLink),
    imageSelection,
  ];
}
