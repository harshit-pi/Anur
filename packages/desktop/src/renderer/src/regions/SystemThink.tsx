import { useMemo } from "react";
import { SYSTEM_DOC, buildSectionTree, systemDocText, systemIndexOf } from "@anur/core";
import { endName, type SystemEdge, type SystemSection } from "../layout/system-levels.ts";
import { Think } from "./Think.tsx";

/**
 * Think beside the system map (29.1): the box picked on the map is a
 * section of the map's virtual doc, so it has threads, Build and Check, and
 * its decisions under Context and history, as a doc's section does; its
 * calls in and out sit there too (29.8).
 */
export function SystemThink({
  sections,
  edges,
  selected,
  writable,
}: {
  sections: readonly SystemSection[];
  edges: readonly SystemEdge[];
  selected: string;
  writable: boolean;
}) {
  const text = useMemo(() => systemDocText(sections), [sections]);
  const tree = useMemo(() => buildSectionTree(text, { fileName: "System" }), [text]);
  const index = systemIndexOf(tree, text, selected);
  const section = index >= 0 ? (tree.sections[index] ?? null) : null;
  const noun = selected.startsWith("repo:")
    ? "repo"
    : selected.startsWith("part:")
      ? "part"
      : selected.startsWith("group:")
        ? "group"
        : "box";
  // A box's calls: the lines with an end in it or in a box inside it.
  const inside = (id: string) => {
    const byId = new Map(sections.map((s) => [s.id, s] as const));
    for (let at: string | null | undefined = id; at; at = byId.get(at)?.parent)
      if (at === selected) return true;
    return false;
  };
  const shown = edges.filter((e) => e.state !== "hidden");
  const callsIn = shown.filter((e) => inside(e.to) && !inside(e.from));
  const callsOut = shown.filter((e) => inside(e.from) && !inside(e.to));
  const count = callsIn.length + callsOut.length;
  const row = (e: SystemEdge, dir: "in" | "out") => {
    const other = endName(sections, dir === "in" ? e.from : e.to).name;
    const decided = e.decisions?.length ?? 0;
    return (
      <li key={`${dir}:${e.id}`}>
        <span className="quiet">{dir}</span>{" "}
        <span className="truncate" title={e.evidence ?? undefined}>
          {dir === "in" ? `${other} → ${e.label}` : `${e.label} → ${other}`}
        </span>
        {decided ? <span className="system-call-decided">{decided} decided</span> : null}
      </li>
    );
  };
  return (
    <Think
      docPath={section ? SYSTEM_DOC : null}
      docText={() => text}
      tree={tree}
      section={section}
      writable={writable}
      request={null}
      onJump={() => undefined}
      page={() => null}
      // No page here, so no section editor: nothing to open or say.
      onOpenLink={() => undefined}
      notify={() => undefined}
      noun={noun}
      extra={
        count ? (
          <details className="think-inputs">
            <summary className="think-subhead">Calls ({String(count)})</summary>
            <ul>
              {callsIn.map((e) => row(e, "in"))}
              {callsOut.map((e) => row(e, "out"))}
            </ul>
          </details>
        ) : null
      }
    />
  );
}
