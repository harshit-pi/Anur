import path from "node:path";

/**
 * Where a page a thread made belongs (30.41): where the agent put it, unless
 * that's inside the attachments folder or a folder the person attached as an
 * input; then beside the doc the thread is on. Attachments hold what people
 * add, never what agents write.
 */
export function pageHome(made: string, doc: string, kept: readonly string[]): string {
  const inside = (dir: string) => {
    const d = dir.replace(/^\.?\/+|\/+$/g, "");
    return d !== "" && (made === d || made.startsWith(`${d}/`));
  };
  if (!kept.some(inside)) return made;
  const dir = path.posix.dirname(doc);
  return path.posix.join(dir === "." ? "" : dir, path.posix.basename(made));
}
