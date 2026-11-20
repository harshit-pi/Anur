import type { ThreadItem } from "../../../shared/ipc-contract.ts";

type Landed = Extract<ThreadItem, { kind: "auto-used" }>;

/**
 * A turn's edits that landed as they came, one line per doc instead of one per
 * section (30.38): the line sits where the turn's last landed edit did. Edits
 * still undoable or taken back keep their own line, since each has its own state.
 */
export function mergeLanded(items: ThreadItem[]): ThreadItem[] {
  const out: ThreadItem[] = [];
  let turn: { doc: string; at: number }[] = [];
  for (const item of items) {
    if (item.kind === "message" && item.role === "person") turn = [];
    if (item.kind !== "auto-used" || item.undoable || item.undone) {
      out.push(item);
      continue;
    }
    const before = turn.find((t) => t.doc === item.doc);
    if (!before) {
      turn.push({ doc: item.doc, at: out.length });
      out.push(item);
      continue;
    }
    const was = out[before.at] as Landed;
    const sections = [...was.sections];
    for (const s of item.sections)
      if (!sections.some((x) => x.join("\0") === s.join("\0"))) sections.push(s);
    out[before.at] = { ...was, sections };
  }
  return out;
}
