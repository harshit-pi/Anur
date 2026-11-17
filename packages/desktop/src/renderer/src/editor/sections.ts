import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import { buildSectionTree, markdownExtensions, type SectionTree } from "@anur/core";

/**
 * The page's Markdown: CodeMirror's language set up with the same extensions
 * core parses with (Architecture, "Stack"), so the editor and the index read
 * a file the same way.
 */
export function markdownSupport(): Extension {
  return markdown({ extensions: markdownExtensions, addKeymap: false });
}

/**
 * The open doc's sections, from the editor's own parse, forced to cover the
 * whole doc (Data Model, "From file to sections to map"), so the page and its
 * sections can never disagree.
 */
export function sectionsOf(state: EditorState, fileName: string): SectionTree {
  const tree = ensureSyntaxTree(state, state.doc.length, 2000) ?? syntaxTree(state);
  return buildSectionTree(state.doc.toString(), { fileName, tree });
}
