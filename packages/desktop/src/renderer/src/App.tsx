import type { EditorView } from "@codemirror/view";
import type { SectionTree } from "@anur/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FolderState } from "../../shared/ipc-contract.ts";
import { Page, type OpenDoc } from "./editor/Page.tsx";
import { Resizer } from "./layout/Resizer.tsx";
import { loadWidths, saveWidths, type Side } from "./layout/panel-widths.ts";
import { anur } from "./bridge.ts";
import { CommandPalette } from "./regions/CommandPalette.tsx";
import { MergeDialog } from "./regions/MergeDialog.tsx";
import {
  Center,
  LeftSidebar,
  Ribbon,
  RightSidebar,
  StatusBar,
  TabBar,
} from "./regions/Regions.tsx";

export function App() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [folder, setFolder] = useState<FolderState | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [merging, setMerging] = useState<string | null>(null);
  const [doc, setDoc] = useState<OpenDoc | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const [sections, setSections] = useState<SectionTree | null>(null);
  const view = useRef<EditorView | null>(null);
  const onView = useCallback((v: EditorView | null) => {
    view.current = v;
  }, []);

  // Open the picked doc; an offloaded one downloads from iCloud first.
  useEffect(() => {
    setDoc(null);
    setSections(null);
    setDocError(null);
    if (!selected) {
      setOpening(null);
      return;
    }
    let current = true;
    setOpening(folder?.offloaded.includes(selected) ? "Downloading from iCloud…" : "Opening…");
    void anur.call("doc:open", { path: selected }).then((r) => {
      if (!current) return;
      setOpening(null);
      if (r.kind === "doc") setDoc(r);
      else setDocError(r.reason);
    });
    return () => {
      current = false;
    };
  }, [selected, folder]);

  const jumpTo = useCallback(
    (index: number) => {
      const target = sections?.sections[index]?.headingRange;
      const v = view.current;
      if (!target || !v) return;
      v.dispatch({ selection: { anchor: target.from }, scrollIntoView: true });
      v.focus();
    },
    [sections],
  );
  const [widths, setWidths] = useState(() => loadWidths(window.localStorage));
  const setWidth = (side: Side) => (width: number) => {
    setWidths((w) => {
      const next = { ...w, [side]: width };
      saveWidths(window.localStorage, next);
      return next;
    });
  };

  useEffect(() => {
    void anur.call("app:info", {}).then((info) => {
      setVersion(info.version);
    });
    void anur.call("folder:current", {}).then(setFolder);
    return anur.on("folder:changed", (f) => {
      setFolder(f);
      setSelected(null);
    });
  }, []);

  const openFolder = useCallback(() => {
    void anur.call("folder:choose", {}).then((r) => {
      if (r.kind === "opened") setFolder(r.folder);
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div
      className="shell"
      style={{
        gridTemplateColumns: `48px ${String(widths.left)}px minmax(0, 1fr) ${String(widths.right)}px`,
      }}
    >
      <TabBar />
      <Ribbon
        onCommand={() => {
          setPaletteOpen(true);
        }}
      />
      <LeftSidebar folder={folder} selected={selected} onSelect={setSelected} />
      <Center
        folder={folder}
        selected={selected}
        page={doc ? <Page doc={doc} onSections={setSections} onView={onView} /> : null}
        opening={opening}
        docNote={doc?.note ?? null}
        docError={docError}
        onOpenFolder={openFolder}
        onMerge={setMerging}
      />
      <RightSidebar sections={sections} onJump={jumpTo} />
      <StatusBar version={version} folder={folder} docMode={doc?.mode ?? null} />
      <Resizer
        side="left"
        width={widths.left}
        offset={48 + widths.left}
        onChange={setWidth("left")}
      />
      <Resizer
        side="right"
        width={widths.right}
        offset={widths.right}
        onChange={setWidth("right")}
      />
      {merging ? (
        <MergeDialog
          copy={merging}
          onClose={() => {
            setMerging(null);
          }}
        />
      ) : null}
      <CommandPalette
        open={paletteOpen}
        onClose={() => {
          setPaletteOpen(false);
        }}
      />
    </div>
  );
}
