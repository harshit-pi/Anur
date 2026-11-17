import {
  Facet,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type EditorState,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { buildSectionTree, partHunks, type PreviewPart, type SectionTree } from "@anur/core";
import type { PreviewView } from "../../../../shared/ipc-contract.ts";
import { inlineRuns } from "../../layout/inline-markdown.ts";

/**
 * A preview in place (task 3.8; Mock 5): under the section's heading, a
 * switch between the text in the doc and each thread's version of it. A
 * thread's version replaces the section's text on the page until it is
 * applied or rejected, and Show changes lists each edit to keep or reject.
 */

export type PreviewActions = {
  apply: (thread: string, part: PreviewPart) => void;
  reject: (thread: string, part: PreviewPart, edits: number[]) => void;
  back: (thread: string) => void;
};

export const previewActions = Facet.define<PreviewActions, PreviewActions | null>({
  combine: (values) => values[0] ?? null,
});

/** What the page shows under one section: the doc's text, or one thread's version. */
type Shown = { thread: string | null; changes: boolean };

type State = { previews: PreviewView[]; shown: Record<string, Shown> };

export const setPreviews = StateEffect.define<PreviewView[]>();
/** Show a section's text as in the doc (thread null) or as a thread proposes it. */
export const showPreview = StateEffect.define<{ key: string; shown: Shown }>();

export const sectionKey = (path: readonly string[]) => path.join("\u0000");

export const previewState = StateField.define<State>({
  create: () => ({ previews: [], shown: {} }),
  update(value, tr) {
    let next = value;
    for (const e of tr.effects) {
      if (e.is(setPreviews)) {
        // A section with a new preview shows it; one the person switched keeps their choice.
        const shown = { ...next.shown };
        for (const p of e.value)
          for (const part of p.parts)
            shown[sectionKey(part.path)] ??= { thread: p.thread, changes: false };
        next = { previews: e.value, shown };
      } else if (e.is(showPreview)) {
        next = { ...next, shown: { ...next.shown, [e.value.key]: e.value.shown } };
      }
    }
    return next;
  },
});

/** The page's sections, parsed again only when the text changed. */
let cached: { doc: unknown; tree: SectionTree } | null = null;
function treeOf(state: EditorState): SectionTree {
  if (cached?.doc !== state.doc)
    cached = {
      doc: state.doc,
      tree: buildSectionTree(state.doc.toString(), { fileName: "doc.md" }),
    };
  return cached.tree;
}

/** Where a part's section is on the page now, found by its heading path. */
export function sectionFor(state: EditorState, path: readonly string[]) {
  const key = sectionKey(path);
  return treeOf(state).sections.find((s) => sectionKey(s.path) === key) ?? null;
}

const bodyOf = (text: string) => text.replace(/^[^\n]*\n?/, "").replace(/^\n+/, "");

function decorations(state: EditorState): DecorationSet {
  const { previews, shown } = state.field(previewState);
  if (previews.length === 0) return Decoration.none;
  const bySection = new Map<string, { thread: string; title: string; part: PreviewPart }[]>();
  for (const p of previews)
    for (const part of p.parts) {
      const key = sectionKey(part.path);
      bySection.set(key, [
        ...(bySection.get(key) ?? []),
        { thread: p.thread, title: p.title, part },
      ]);
    }
  const found: { from: number; to: number; deco: Decoration }[] = [];
  let lastReplaced = -1;
  for (const [key, offers] of bySection) {
    const s = sectionFor(state, offers[0]?.part.path ?? []);
    if (!s?.headingRange) continue;
    const heading = state.doc.lineAt(s.headingRange.from);
    const pick = shown[key] ?? { thread: null, changes: false };
    const chosen = offers.find((o) => o.thread === pick.thread) ?? null;
    found.push({
      from: heading.to,
      to: heading.to,
      deco: Decoration.widget({
        widget: new TabsWidget(
          key,
          offers.map((o) => ({ thread: o.thread, title: o.title })),
          chosen?.thread ?? null,
        ),
        block: true,
        side: 1,
      }),
    });
    if (!chosen) continue;
    const body = new BodyWidget(chosen.thread, chosen.title, chosen.part, pick.changes, key);
    const from = Math.min(heading.to + 1, state.doc.length);
    const end = s.subtreeRange.to;
    const last = end > from ? state.doc.lineAt(Math.max(from, end - 1)) : null;
    if (last && last.to > from && from > lastReplaced) {
      found.push({ from, to: last.to, deco: Decoration.replace({ widget: body, block: true }) });
      lastReplaced = last.to;
    } else {
      found.push({
        from: heading.to,
        to: heading.to,
        deco: Decoration.widget({ widget: body, block: true, side: 2 }),
      });
    }
  }
  found.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const f of found) builder.add(f.from, f.to, f.deco);
  return builder.finish();
}

export const previewDecorations = EditorView.decorations.compute(
  ["doc", previewState],
  decorations,
);

class TabsWidget extends WidgetType {
  constructor(
    readonly key: string,
    readonly offers: { thread: string; title: string }[],
    readonly chosen: string | null,
  ) {
    super();
  }
  override eq(o: TabsWidget) {
    return (
      o.key === this.key &&
      o.chosen === this.chosen &&
      o.offers.map((x) => x.thread).join() === this.offers.map((x) => x.thread).join()
    );
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-preview-tabs";
    wrap.contentEditable = "false";
    wrap.setAttribute("role", "tablist");
    wrap.setAttribute("aria-label", "This section: in the doc, or as a thread proposes");
    const tab = (label: string, thread: string | null) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cm-preview-tab";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(thread === this.chosen));
      b.textContent = label;
      b.title = thread ? `${label}: not in the file yet` : "The text in the file";
      b.addEventListener("mousedown", (e) => {
        e.preventDefault();
        view.dispatch({
          effects: showPreview.of({ key: this.key, shown: { thread, changes: false } }),
        });
      });
      return b;
    };
    wrap.append(tab("In the doc", null));
    for (const o of this.offers) wrap.append(tab(shortTitle(o.title), o.thread));
    return wrap;
  }
  override ignoreEvent() {
    return true;
  }
}

const shortTitle = (t: string) => {
  const words = t.replace(/[?.!]+$/, "").split(/\s+/);
  return words.length > 5 ? `${words.slice(0, 5).join(" ")}…` : words.join(" ");
};

class BodyWidget extends WidgetType {
  constructor(
    readonly thread: string,
    readonly title: string,
    readonly part: PreviewPart,
    readonly changes: boolean,
    readonly key: string,
  ) {
    super();
  }
  override eq(o: BodyWidget) {
    return (
      o.thread === this.thread &&
      o.changes === this.changes &&
      o.part.proposed === this.part.proposed &&
      o.part.base === this.part.base
    );
  }
  override get estimatedHeight() {
    return 160;
  }
  toDOM(view: EditorView) {
    const actions = view.state.facet(previewActions);
    const wrap = document.createElement("div");
    wrap.className = "cm-preview";
    wrap.contentEditable = "false";
    const content = document.createElement("div");
    content.className = "cm-preview-content";
    if (this.changes)
      drawChanges(content, this.part, (i) => actions?.reject(this.thread, this.part, [i]));
    else drawMarkdown(content, bodyOf(this.part.proposed));
    wrap.append(content);

    const foot = document.createElement("div");
    foot.className = "cm-preview-foot";
    const note = document.createElement("span");
    note.className = "cm-preview-note";
    note.textContent = `Preview from the “${shortTitle(this.title)}” thread. Not in the file yet.`;
    const toggle = document.createElement("label");
    toggle.className = "cm-preview-toggle";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.changes;
    box.addEventListener("change", () => {
      view.dispatch({
        effects: showPreview.of({
          key: this.key,
          shown: { thread: this.thread, changes: box.checked },
        }),
      });
    });
    toggle.append(box, " Show changes");
    const back = button("Back to thinking", false, () => actions?.back(this.thread));
    const apply = button("Apply", true, () => actions?.apply(this.thread, this.part));
    foot.append(note, toggle, back, apply);
    wrap.append(foot);
    return wrap;
  }
  override ignoreEvent() {
    return true;
  }
}

function button(label: string, primary: boolean, onClick: () => void) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = primary ? "cm-preview-button primary" : "cm-preview-button";
  b.textContent = label;
  b.addEventListener("mousedown", (e) => {
    e.preventDefault();
  });
  b.addEventListener("click", onClick);
  return b;
}

/** Each edit: what goes, what comes, and Reject to keep the doc's text there. */
function drawChanges(el: HTMLElement, part: PreviewPart, reject: (i: number) => void) {
  const hunks = partHunks(part);
  hunks.forEach((h, i) => {
    const edit = document.createElement("div");
    edit.className = "cm-preview-edit";
    const lines = (text: string, cls: string) => {
      for (const line of text.replace(/\n$/, "").split("\n")) {
        const d = document.createElement("div");
        d.className = cls;
        d.textContent = line || " ";
        edit.append(d);
      }
    };
    if (h.removed) lines(h.removed, "cm-preview-del");
    if (h.added) lines(h.added, "cm-preview-ins");
    const row = document.createElement("div");
    row.className = "cm-preview-edit-actions";
    row.append(
      button(
        hunks.length === 1 ? "Reject this edit" : `Reject edit ${String(i + 1)}`,
        false,
        () => {
          reject(i);
        },
      ),
    );
    edit.append(row);
    el.append(edit);
  });
}

/** The proposed text, drawn as the page draws it: headings, lists and inline styles. */
function drawMarkdown(el: HTMLElement, text: string) {
  for (const block of text.split(/\n{2,}/)) {
    if (!block.trim()) continue;
    const lines = block.split("\n");
    const heading = /^(#{1,6})\s/.exec(block);
    if (heading) {
      const h = document.createElement("div");
      h.className = `cm-preview-h cm-preview-h${String(heading[1]?.length ?? 2)}`;
      inline(h, lines[0] ?? "");
      el.append(h);
      const rest = lines.slice(1).join("\n").trim();
      if (rest) drawMarkdown(el, rest);
      continue;
    }
    if (lines.every((l) => /^\s*(?:[-*+]|\d+[.)])\s/.test(l) || !l.trim())) {
      const ul = document.createElement("ul");
      for (const l of lines.filter((x) => x.trim())) {
        const li = document.createElement("li");
        inline(li, l);
        ul.append(li);
      }
      el.append(ul);
      continue;
    }
    const p = document.createElement("p");
    lines.forEach((l, i) => {
      if (i > 0) p.append(document.createElement("br"));
      inline(p, l);
    });
    el.append(p);
  }
}

function inline(el: HTMLElement, line: string) {
  for (const r of inlineRuns(line)) {
    const span = document.createElement("span");
    if (r.marks.length) span.className = r.marks.map((m) => `md-${m}`).join(" ");
    span.textContent = r.text;
    el.append(span);
  }
}

const previewTheme = EditorView.baseTheme({
  ".cm-preview-tabs": {
    display: "inline-flex",
    gap: "2px",
    margin: "6px 0 10px",
    padding: "3px",
    borderRadius: "10px",
    background: "var(--paper)",
    fontFamily: "var(--font-ui)",
    fontSize: "13px",
  },
  ".cm-preview-tab": {
    padding: "4px 12px",
    border: "none",
    borderRadius: "7px",
    background: "transparent",
    color: "var(--slate)",
    font: "inherit",
    cursor: "pointer",
  },
  ".cm-preview-tab[aria-selected=true]": {
    background: "var(--sheet)",
    color: "var(--ink)",
    boxShadow: "0 1px 2px var(--shadow)",
  },
  ".cm-preview": {
    margin: "0 0 14px",
    padding: "14px 18px 12px",
    borderLeft: "3px solid var(--blue)",
    borderRadius: "0 10px 10px 0",
    background: "var(--blue-wash)",
  },
  ".cm-preview-content p": { margin: "0 0 10px" },
  ".cm-preview-content ul": { margin: "0 0 10px", paddingLeft: "22px" },
  ".cm-preview-h": { fontWeight: "650", margin: "6px 0 8px" },
  ".cm-preview-h3": { fontSize: "1.1em" },
  ".cm-preview-content .md-bold": { fontWeight: "650" },
  ".cm-preview-content .md-italic": { fontStyle: "italic" },
  ".cm-preview-content .md-strike": { textDecoration: "line-through" },
  ".cm-preview-content .md-code": {
    padding: "0 3px",
    borderRadius: "3px",
    background: "var(--hover)",
    fontFamily: "ui-monospace, 'SF Mono', monospace",
    fontSize: "0.88em",
  },
  ".cm-preview-content .md-link": { color: "var(--blue)" },
  ".cm-preview-edit": {
    margin: "0 0 10px",
    padding: "6px 8px",
    borderRadius: "6px",
    background: "var(--sheet)",
    fontSize: "0.92em",
  },
  ".cm-preview-del": {
    padding: "1px 6px",
    background: "var(--red-wash)",
    textDecoration: "line-through",
    color: "var(--slate)",
    whiteSpace: "pre-wrap",
  },
  ".cm-preview-ins": {
    padding: "1px 6px",
    background: "var(--green-wash)",
    whiteSpace: "pre-wrap",
  },
  ".cm-preview-edit-actions": { display: "flex", justifyContent: "flex-end", marginTop: "4px" },
  ".cm-preview-foot": {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "10px",
    marginTop: "8px",
    fontFamily: "var(--font-ui)",
    fontSize: "13px",
    color: "var(--slate)",
  },
  ".cm-preview-note": { flex: "1 1 220px" },
  ".cm-preview-toggle": {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    cursor: "pointer",
  },
  ".cm-preview-button": {
    padding: "6px 14px",
    border: "1px solid var(--rule)",
    borderRadius: "8px",
    background: "var(--sheet)",
    color: "var(--ink)",
    font: "inherit",
    cursor: "pointer",
  },
  ".cm-preview-button.primary": {
    borderColor: "var(--ink)",
    background: "var(--ink)",
    color: "var(--sheet)",
  },
});

export const previewExtension = [previewState, previewDecorations, previewTheme];
