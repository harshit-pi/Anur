import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { StateEffect, StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import {
  BulletWidget,
  CalloutLabelWidget,
  CheckboxWidget,
  EmbedWidget,
  PropertiesWidget,
  RuleWidget,
  TableWidget,
  TextWidget,
} from "./widgets.ts";

/**
 * Live preview (task 2.6): the page renders Markdown in place, as Obsidian
 * does, while the document stays the file's exact text. Wherever a cursor or
 * selection touches, the source shows, so what is being read or edited is
 * always the real characters. Everything comes from the editor's own parse.
 */

const hide = Decoration.replace({});
const mark = (cls: string) => Decoration.mark({ class: cls });
const line = (cls: string) => Decoration.line({ class: cls });

/** The lines a cursor or selection touches; their Markdown shows as source. */
function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number;
    const last = state.doc.lineAt(r.to).number;
    for (let n = first; n <= last; n++) lines.add(n);
  }
  return lines;
}

/** Frontmatter as key and values; null when it isn't simple enough to show as properties. */
export function parseProperties(yaml: string): [string, string[]][] | null {
  const props: [string, string[]][] = [];
  const unquote = (s: string) => s.trim().replace(/^(["'])(.*)\1$/, "$2");
  for (const raw of yaml.split("\n")) {
    if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
    const item = /^\s+-\s+(.*)$/.exec(raw);
    const last = props.at(-1);
    if (item?.[1] !== undefined && last) {
      last[1].push(unquote(item[1]));
      continue;
    }
    const kv = /^([A-Za-z0-9_][\w.-]*)\s*:\s*(.*)$/.exec(raw);
    if (!kv?.[1]) return null;
    const value = kv[2]?.trim() ?? "";
    if (value === "") props.push([kv[1], []]);
    else if (value.startsWith("[") && value.endsWith("]") && !value.startsWith("[[")) {
      props.push([kv[1], value.slice(1, -1).split(",").map(unquote).filter(Boolean)]);
    } else props.push([kv[1], [unquote(value)]]);
  }
  return props;
}

/** A table row's cells, split at "|" but not at an escaped "\|". */
export function splitRow(row: string): string[] {
  let s = row.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (c === "\\" && s.charAt(i + 1) === "|") {
      cur += "\\|";
      i++;
    } else if (c === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

function tableWidget(text: string): TableWidget | null {
  const rows = text.split("\n").filter((l) => l.trim() !== "");
  const [head, delim, ...body] = rows;
  if (!head || !delim) return null;
  const align = splitRow(delim).map((d) => {
    const left = d.startsWith(":");
    const right = d.endsWith(":");
    return left && right
      ? ("center" as const)
      : right
        ? ("right" as const)
        : left
          ? ("left" as const)
          : null;
  });
  return new TableWidget(splitRow(head), body.map(splitRow), align);
}

/**
 * The decorations for a state. Unfocused, nothing counts as under the cursor,
 * so a doc just opened (cursor at the start) reads fully rendered.
 */
export function buildLivePreview(state: EditorState, focused = true): DecorationSet {
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);
  const doc = state.doc;
  const active = focused ? activeLines(state) : new Set<number>();
  const isActive = (from: number, to: number) => {
    const a = doc.lineAt(from).number;
    const b = doc.lineAt(to).number;
    for (let n = a; n <= b; n++) if (active.has(n)) return true;
    return false;
  };
  const out: Range<Decoration>[] = [];
  const text = (from: number, to: number) => doc.sliceString(from, to);
  /** Hide a mark and the spaces after it on the same line. */
  const hideWithSpace = (from: number, to: number) => {
    let end = to;
    const lineEnd = doc.lineAt(from).to;
    while (end < lineEnd && text(end, end + 1) === " ") end++;
    if (end > from) out.push(hide.range(from, end));
  };
  const children = (node: SyntaxNode, name: string) => {
    const found: SyntaxNode[] = [];
    for (let c = node.firstChild; c; c = c.nextSibling) if (c.name === name) found.push(c);
    return found;
  };

  tree.iterate({
    enter(ref) {
      const node = ref.node;
      const { from, to, name } = node;
      if (to <= from) return;

      switch (name) {
        case "Frontmatter": {
          if (isActive(from, to)) return false;
          const body = text(from, to).split("\n").slice(1, -1).join("\n");
          const props = parseProperties(body);
          if (props)
            out.push(
              Decoration.replace({ widget: new PropertiesWidget(props), block: true }).range(
                from,
                to,
              ),
            );
          return false;
        }
        case "Table": {
          if (isActive(from, to)) return false;
          const widget = tableWidget(text(from, to));
          if (widget) out.push(Decoration.replace({ widget, block: true }).range(from, to));
          return false;
        }
        case "HorizontalRule":
          if (!isActive(from, to))
            out.push(Decoration.replace({ widget: new RuleWidget() }).range(from, to));
          return false;
        case "FencedCode":
        case "CodeBlock":
          for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) {
            out.push(line("cm-lp-codeblock").range(doc.line(n).from));
          }
          // A fence's backticks and language hide off the cursor line.
          for (const c of [...children(node, "CodeMark"), ...children(node, "CodeInfo")]) {
            if (!isActive(c.from, c.to)) out.push(hide.range(c.from, c.to));
          }
          return false;
        case "Blockquote": {
          const firstLine = doc.lineAt(from);
          const callout = /^\s*>\s?\[!([A-Za-z]+)\][+-]?/.exec(firstLine.text);
          const kind = callout?.[1]?.toLowerCase();
          for (let n = firstLine.number; n <= doc.lineAt(to).number; n++) {
            const cls = kind
              ? `cm-lp-callout cm-lp-callout-${kind}${n === firstLine.number ? " cm-lp-callout-first" : ""}`
              : "cm-lp-quote";
            out.push(line(cls).range(doc.line(n).from));
          }
          if (kind && callout && !active.has(firstLine.number)) {
            const start = firstLine.from + firstLine.text.indexOf("[!");
            const end = firstLine.from + callout[0].length;
            out.push(
              Decoration.replace({ widget: new CalloutLabelWidget(kind) }).range(start, end),
            );
          }
          return;
        }
        case "QuoteMark":
          if (!isActive(from, to)) hideWithSpace(from, to);
          return;
        case "HeaderMark": {
          if (isActive(from, to)) return;
          const parent = node.parent?.name ?? "";
          if (parent.startsWith("SetextHeading")) out.push(hide.range(from, to));
          else hideWithSpace(from, to);
          return;
        }
        case "EmphasisMark":
        case "StrikethroughMark":
          if (!isActive(from, to)) out.push(hide.range(from, to));
          return;
        case "InlineCode": {
          if (isActive(from, to)) return false;
          const marks = children(node, "CodeMark");
          const [open, close] = [marks[0], marks.at(-1)];
          if (open && close && open !== close) {
            out.push(hide.range(open.from, open.to), hide.range(close.from, close.to));
            if (open.to < close.from) out.push(mark("cm-lp-code").range(open.to, close.from));
          }
          return false;
        }
        case "Link": {
          // Descends, so bold or code inside the link text renders too.
          if (isActive(from, to)) return;
          const marks = children(node, "LinkMark");
          const url = children(node, "URL")[0];
          const open = marks[0];
          const close = marks[1];
          if (!open || !close || !url) return;
          out.push(hide.range(open.from, open.to));
          if (open.to < close.from) out.push(mark("cm-lp-link").range(open.to, close.from));
          out.push(hide.range(close.from, to));
          return;
        }
        case "Image":
          if (!isActive(from, to)) {
            const url = children(node, "URL")[0];
            const label = url ? text(url.from, url.to) : text(from, to);
            out.push(Decoration.replace({ widget: new EmbedWidget(label) }).range(from, to));
          }
          return false;
        case "WikiEmbed":
          if (!isActive(from, to)) {
            const target = children(node, "WikiLinkTarget")[0];
            out.push(
              Decoration.replace({
                widget: new EmbedWidget(target ? text(target.from, target.to) : ""),
              }).range(from, to),
            );
          }
          return false;
        case "WikiLink": {
          if (isActive(from, to)) return false;
          const target = children(node, "WikiLinkTarget")[0];
          const heading = children(node, "WikiLinkHeading")[0];
          const alias = children(node, "WikiLinkAlias")[0];
          if (alias) {
            out.push(
              hide.range(from, alias.from),
              mark("cm-lp-link").range(alias.from, alias.to),
              hide.range(alias.to, to),
            );
            return false;
          }
          const shown = [target, heading].filter((n): n is SyntaxNode => Boolean(n));
          const [first, second] = shown;
          if (!first) return false;
          out.push(hide.range(from, first.from), mark("cm-lp-link").range(first.from, first.to));
          if (second) {
            out.push(
              Decoration.replace({ widget: new TextWidget(" › ", "cm-lp-link") }).range(
                first.to,
                second.from,
              ),
              mark("cm-lp-link").range(second.from, second.to),
            );
          }
          out.push(hide.range((second ?? first).to, to));
          return false;
        }
        case "ListMark": {
          if (isActive(from, to)) return;
          const listName = node.parent?.parent?.name;
          const task = node.parent ? children(node.parent, "Task")[0] : undefined;
          if (listName === "BulletList" && !task) {
            out.push(Decoration.replace({ widget: new BulletWidget() }).range(from, to));
          } else if (task) out.push(hide.range(from, to + (text(to, to + 1) === " " ? 1 : 0)));
          return;
        }
        case "TaskMarker":
          if (!isActive(from, to)) {
            const checked = /x/i.test(text(from, to));
            out.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(from, to));
          }
          return;
        default:
          return;
      }
    },
  });

  return Decoration.set(out, true);
}

const setFocused = StateEffect.define<boolean>();

const previewField = StateField.define<{ focused: boolean; decorations: DecorationSet }>({
  create: (state) => ({ focused: false, decorations: buildLivePreview(state, false) }),
  update(value, tr) {
    let focused = value.focused;
    for (const e of tr.effects) if (e.is(setFocused)) focused = e.value;
    const stale =
      focused !== value.focused ||
      tr.docChanged ||
      tr.selection ||
      syntaxTree(tr.startState) !== syntaxTree(tr.state);
    return stale ? { focused, decorations: buildLivePreview(tr.state, focused) } : value;
  },
  provide: (field) => EditorView.decorations.from(field, (v) => v.decorations),
});

/** Live preview for a page: the decorations, kept in step with focus. */
export const livePreview = [
  previewField,
  EditorView.focusChangeEffect.of((_, focusing) => setFocused.of(focusing)),
];
