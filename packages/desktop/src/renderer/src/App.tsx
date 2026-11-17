import { useEffect, useState } from "react";
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
    <div className="shell">
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
      <CommandPalette
        open={paletteOpen}
        onClose={() => {
          setPaletteOpen(false);
        }}
      />
    </div>
  );
}
