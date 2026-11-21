import { Prec, type EditorState } from "@codemirror/state";
import { EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { Response } from "../../../../shared/ipc-contract.ts";
import { pagePath } from "../bases/base-widget.ts";
import { EmbedWidget, openPathEditor } from "../chips/chip-widgets.ts";
import { anur } from "../../bridge.ts";

/**
 * An image a doc embeds, alone on its line, drawn as the image (task 2.27):
 * `![[Peacock bookmark reference.webp]]` or `![alt](path)`. Its path stays
 * on a small chip under it, which a click edits, as before.
 *
 * - A click on the image selects its line, so Delete removes it and ⌘C
 *   copies it, as for any text.
 * - The corner handle resizes it; the width is written Obsidian's way, as
 *   `![[name.png|400]]` or `![alt|400](path)`.
 * - A copied image pasted on the page, or an image file dropped on it, is
 *   saved in the folder where Obsidian would put it and embedded there.
 *
 * Main finds and reads the file, since the page can't; it is read again when
 * the window comes back to the front, so an edit elsewhere shows.
 */

type Read = Response<"image:read">;

/** Read images by page and target, kept while Anur runs. */
const cache = new Map<string, Read>();

/** `300` or `300x200` after a "|", as Obsidian sizes an embed. */
export function sizeOf(alias: string | null): { width: number; height: number | null } | null {
  const m = alias ? /^(\d{1,5})(?:x(\d{1,5}))?$/.exec(alias.trim()) : null;
  return m?.[1] ? { width: Number(m[1]), height: m[2] ? Number(m[2]) : null } : null;
}

export const isImagePath = (p: string) =>
  /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(p.split(/[?#]/)[0] ?? "");

/** A web address: drawn as an image when Markdown marks it as one, whatever its ending (2.28). */
export const isWebAddress = (p: string) => /^https?:\/\//i.test(p.trim());

/**
 * Ask main for an image, drawing what was read before at once, then again
 * whenever the window comes back to the front. Returns the stop function.
 */
function watchImage(view: EditorView, target: string, draw: (r: Read) => void): () => void {
  const from = view.state.facet(pagePath);
  const key = `${from}\0${target}`;
  const load = () => {
    void anur.call("image:read", { target, from }).then((r) => {
      cache.set(key, r);
      draw(r);
    });
  };
  const known = cache.get(key);
  if (known) draw(known);
  load();
  window.addEventListener("focus", load);
  return () => {
    window.removeEventListener("focus", load);
  };
}

/** The embed's line with its width set: `|400` added or changed, Obsidian's way. */
export function withWidth(line: string, width: number): string | null {
  const w = String(Math.round(width));
  const wiki = /^(!\[\[)([^\]|]+)(?:\|[^\]]*)?(\]\])(.*)$/.exec(line);
  if (wiki) return `${wiki[1] ?? ""}${wiki[2] ?? ""}|${w}${wiki[3] ?? ""}${wiki[4] ?? ""}`;
  const md = /^(!\[)([^\]|]*)(?:\|[^\]]*)?(\]\(.*)$/.exec(line);
  if (md) return `${md[1] ?? ""}${md[2] ?? ""}|${w}${md[3] ?? ""}`;
  return null;
}

/** The line a widget stands for, from its DOM. */
function lineOf(view: EditorView, dom: HTMLElement) {
  const pos = view.posAtDOM(dom);
  return view.state.doc.lineAt(Math.min(pos, view.state.doc.length));
}

export class ImageWidget extends WidgetType {
  constructor(
    readonly target: string,
    readonly alt: string,
    readonly size: { width: number; height: number | null } | null,
  ) {
    super();
  }
  override eq(other: ImageWidget) {
    return (
      other.target === this.target &&
      other.alt === this.alt &&
      other.size?.width === this.size?.width &&
      other.size?.height === this.size?.height
    );
  }
  override get estimatedHeight() {
    return this.size?.height ?? 240;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("figure");
    wrap.className = "cm-lp-image";
    wrap.contentEditable = "false";
    const frame = document.createElement("div");
    frame.className = "cm-lp-image-frame";
    const img = document.createElement("img");
    img.alt = this.alt || this.target;
    img.draggable = false;
    if (this.size) {
      img.style.width = `${String(this.size.width)}px`;
      if (this.size.height) img.style.height = `${String(this.size.height)}px`;
    }
    const handle = document.createElement("div");
    handle.className = "cm-lp-image-handle";
    handle.title = "Drag to resize";
    frame.append(img, handle);
    const note = document.createElement("div");
    note.className = "cm-lp-image-note";
    wrap.append(frame, note, new EmbedWidget(this.target).toDOM(view));

    // A click selects the embed's line: Delete removes it, ⌘C copies it.
    img.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const line = lineOf(view, wrap);
      view.dispatch({ selection: { anchor: line.from, head: line.to } });
      view.focus();
    });

    // The corner handle: drag to resize, written as the embed's width on release.
    handle.addEventListener("pointerdown", (e) => {
      if (view.state.readOnly) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {
        // No live pointer to capture: the drag still follows the events it gets.
      }
      const startX = e.clientX;
      const startW = img.getBoundingClientRect().width;
      const max = wrap.getBoundingClientRect().width;
      let width = startW;
      const move = (ev: PointerEvent) => {
        width = Math.max(48, Math.min(max, startW + ev.clientX - startX));
        img.style.width = `${String(Math.round(width))}px`;
        img.style.height = "auto";
      };
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        if (Math.abs(width - startW) < 2) return;
        const line = lineOf(view, wrap);
        const next = withWidth(line.text, width);
        if (next && next !== line.text)
          view.dispatch({
            changes: { from: line.from, to: line.to, insert: next },
            userEvent: "input.resize",
          });
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
    });

    frame.hidden = true;
    const stop = watchImage(view, this.target, (r) => {
      if (r.kind === "image") {
        img.src = r.dataUrl;
        frame.hidden = false;
        note.textContent = "";
      } else {
        frame.hidden = true;
        note.textContent = r.reason;
      }
      view.requestMeasure();
    });
    stops.set(wrap, stop);
    return wrap;
  }

  override destroy(dom: HTMLElement) {
    stops.get(dom)?.();
  }

  override ignoreEvent() {
    return true;
  }
}

/**
 * An image inside a line of text (2.29), drawn in the line at its height, or
 * at the width its embed gives. Until it loads, or if it can't, its path chip
 * shows instead; a click on the image opens the same path pop-up.
 */
export class InlineImageWidget extends WidgetType {
  constructor(
    readonly target: string,
    readonly alt: string,
    readonly size: { width: number; height: number | null } | null,
  ) {
    super();
  }
  override eq(other: InlineImageWidget) {
    return (
      other.target === this.target &&
      other.alt === this.alt &&
      other.size?.width === this.size?.width &&
      other.size?.height === this.size?.height
    );
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("span");
    wrap.className = "cm-lp-inline-image";
    wrap.contentEditable = "false";
    const img = document.createElement("img");
    img.alt = this.alt || this.target;
    img.draggable = false;
    img.title = this.target;
    img.hidden = true;
    if (this.size) {
      img.classList.add("sized");
      img.style.width = `${String(this.size.width)}px`;
      if (this.size.height) img.style.height = `${String(this.size.height)}px`;
    }
    const chip = new EmbedWidget(this.target).toDOM(view);
    wrap.append(img, chip);
    img.addEventListener("mousedown", (e) => {
      e.preventDefault();
      openPathEditor(view, wrap);
    });
    const stop = watchImage(view, this.target, (r) => {
      const drawn = r.kind === "image";
      if (drawn) img.src = r.dataUrl;
      img.hidden = !drawn;
      chip.hidden = drawn;
      chip.title = drawn ? "Change the path" : r.reason;
    });
    stops.set(wrap, stop);
    return wrap;
  }

  override destroy(dom: HTMLElement) {
    stops.get(dom)?.();
  }

  override ignoreEvent() {
    return true;
  }
}

const stops = new WeakMap<HTMLElement, () => void>();

/** An image shows as selected while the selection covers its whole line. */
export const imageSelection = ViewPlugin.define((view) => {
  const mark = (state: EditorState) => {
    const sel = state.selection.main;
    for (const el of view.dom.querySelectorAll<HTMLElement>(".cm-lp-image")) {
      let on = false;
      if (!sel.empty) {
        const line = state.doc.lineAt(Math.min(view.posAtDOM(el), state.doc.length));
        on = sel.from <= line.from && sel.to >= line.to;
      }
      el.classList.toggle("selected", on);
    }
  };
  return {
    update(u) {
      if (u.selectionSet || u.docChanged || u.viewportChanged) mark(u.state);
    },
  };
});

/** The image files on a clipboard or a drop, if any. */
function imagesIn(data: DataTransfer | null): File[] {
  if (!data) return [];
  return [...data.files].filter((f) => f.type.startsWith("image/"));
}

const toBase64 = async (file: File) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Keep each image in the folder, then embed them at `pos`, each on its own line. */
async function keepImages(
  view: EditorView,
  files: File[],
  pos: number,
  notify: (m: string) => void,
) {
  const from = view.state.facet(pagePath);
  const embeds: string[] = [];
  for (const file of files) {
    const r = await anur.call("image:save", {
      from,
      // A copied screenshot has no name of its own: Obsidian's "Pasted image" name is used.
      name: file.name && file.name !== "image.png" ? file.name : "",
      type: file.type,
      data: await toBase64(file),
    });
    if (r.kind === "saved") embeds.push(`![[${r.name}]]`);
    else notify(r.reason);
  }
  if (embeds.length === 0) return;
  const line = view.state.doc.lineAt(Math.min(pos, view.state.doc.length));
  const before = line.text.slice(0, pos - line.from).trim() ? "\n" : "";
  const after = line.text.slice(pos - line.from).trim() ? "\n" : "";
  const insert = `${before}${embeds.join("\n")}${after}`;
  view.dispatch({
    changes: { from: pos, insert },
    selection: { anchor: pos + insert.length },
    // Its own tag: the paste guard reshapes pasted lines, and this is an embed Anur wrote.
    userEvent: "input.image",
    scrollIntoView: true,
  });
}

/** Paste a copied image, or drop image files, onto the page (2.27). */
export function imagePasteDrop(notify: (message: string) => void) {
  return Prec.high(
    EditorView.domEventHandlers({
      paste(e, view) {
        const files = imagesIn(e.clipboardData);
        if (files.length === 0 || view.state.readOnly) return false;
        e.preventDefault();
        void keepImages(view, files, view.state.selection.main.head, notify);
        return true;
      },
      drop(e, view) {
        const files = imagesIn(e.dataTransfer);
        if (files.length === 0 || view.state.readOnly) return false;
        e.preventDefault();
        const pos =
          view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head;
        void keepImages(view, files, pos, notify);
        return true;
      },
    }),
  );
}
