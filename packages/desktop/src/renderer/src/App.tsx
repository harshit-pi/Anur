import { useCallback, useEffect, useState } from "react";
import type { FolderState } from "../../shared/ipc-contract.ts";
import { Resizer } from "./layout/Resizer.tsx";
import { loadWidths, saveWidths, type Side } from "./layout/panel-widths.ts";
import { anur } from "./bridge.ts";
import { CommandPalette } from "./regions/CommandPalette.tsx";
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
      <Center folder={folder} selected={selected} onOpenFolder={openFolder} />
      <RightSidebar />
      <StatusBar version={version} folder={folder} />
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
      <CommandPalette
        open={paletteOpen}
        onClose={() => {
          setPaletteOpen(false);
        }}
      />
    </div>
  );
}
