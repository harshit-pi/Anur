import { useEffect, useState } from "react";
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
      <LeftSidebar />
      <Center />
      <RightSidebar />
      <StatusBar version={version} />
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
