import { decompressFromBase64 } from "lz-string";

/**
 * Excalidraw drawings as Obsidian's Excalidraw plugin keeps them, so both
 * apps work on the same file: a `.excalidraw.md` note whose "## Drawing"
 * holds the scene as JSON (or LZ-compressed JSON), with "## Text Elements"
 * listing the drawing's words for search; or a plain `.excalidraw` JSON file.
 */

export const isDrawing = (p: string) => /\.excalidraw(\.md)?$/i.test(p);

const BLOCK = /```(json|compressed-json)\n([\s\S]*?)\n```/;

/** The scene's JSON, or null when the file holds none. */
export function sceneOf(text: string, file: string): string | null {
  if (!/\.md$/i.test(file)) return text.trim() ? text : null;
  const m = BLOCK.exec(text);
  if (!m?.[2]) return null;
  if (m[1] === "json") return m[2];
  return decompressFromBase64(m[2].replace(/\s+/g, "")) || null;
}

type Element = { id?: string; type?: string; text?: string; isDeleted?: boolean };

/** The file with a new scene: the drawing replaced, its words listed again, the rest kept. */
export function withScene(text: string, file: string, scene: string): string {
  if (!/\.md$/i.test(file)) return scene;
  let elements: Element[] = [];
  try {
    elements = (JSON.parse(scene) as { elements?: Element[] }).elements ?? [];
  } catch {
    // Not JSON: the words list stays as it was.
  }
  const words = elements
    .filter((e) => e.type === "text" && !e.isDeleted && e.text && e.id)
    .map((e) => `${(e.text ?? "").trim()} ^${e.id ?? ""}`)
    .join("\n\n");
  // The plugin reads plain JSON as well as compressed; plain keeps diffs readable.
  let out = BLOCK.test(text)
    ? text.replace(BLOCK, () => "```json\n" + scene + "\n```")
    : `${text.trimEnd()}\n\n%%\n## Drawing\n\`\`\`json\n${scene}\n\`\`\`\n%%\n`;
  out = out.replace(
    /(## Text Elements\n)([\s\S]*?)(\n(?:%%|## |\^)[\s\S]*)$/,
    (_all, head: string, _old: string, tail: string) => `${head}${words}\n${tail}`,
  );
  return out;
}

/** A new, empty drawing file in the plugin's format. */
export function emptyDrawing(): string {
  const scene = JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "anur",
    elements: [],
    appState: { viewBackgroundColor: "#ffffff" },
    files: {},
  });
  return [
    "---",
    "",
    "excalidraw-plugin: parsed",
    "tags: [excalidraw]",
    "",
    "---",
    "==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠==",
    "",
    "",
    "# Excalidraw Data",
    "",
    "## Text Elements",
    "%%",
    "## Drawing",
    "```json",
    scene,
    "```",
    "%%",
    "",
  ].join("\n");
}

/**
 * Where an embed's drawing is: `![[Flow.excalidraw]]` is Obsidian's
 * `Flow.excalidraw.md`, nearest the page first, then by path, then by name.
 */
export function findDrawing(files: readonly string[], target: string, from: string): string | null {
  const t = target.replace(/^\//, "").replace(/#.*$/, "");
  const names = /\.md$/i.test(t)
    ? [t]
    : /\.excalidraw$/i.test(t)
      ? [`${t}.md`, t]
      : [`${t}.excalidraw.md`, `${t}.excalidraw`, `${t}.md`];
  const here = from.includes("/") ? from.slice(0, from.lastIndexOf("/") + 1).toLowerCase() : "";
  const lower = files.map((f) => f.toLowerCase());
  for (const n of names.map((x) => x.toLowerCase())) {
    const near = n.includes("/") ? -1 : lower.indexOf(here + n);
    const exact = lower.indexOf(n);
    const byName = lower.findIndex((f) => f.endsWith(`/${n}`));
    const i = near >= 0 ? near : exact >= 0 ? exact : byName;
    if (i >= 0 && isDrawing(files[i] ?? "")) return files[i] ?? null;
  }
  return null;
}
