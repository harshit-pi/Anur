import { useEffect, useRef, useState } from "react";
import { anur } from "../bridge.ts";
import { OpenFromButtons } from "./PluginUI.tsx";

/**
 * Spaces (Spaces mock; docs/anur-folder.md): the start page's list of them,
 * and the switcher at the foot of the files panel, as in Obsidian.
 */

type Space = { path: string; name: string; github: boolean };

function useSpaces(open: boolean): Space[] {
  const [spaces, setSpaces] = useState<Space[]>([]);
  useEffect(() => {
    if (!open) return;
    void anur.call("spaces:list", {}).then((r) => {
      setSpaces(r.spaces);
    });
  }, [open]);
  return spaces;
}

const initial = (name: string) => (name.trim()[0] ?? "?").toUpperCase();
const home = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

function openSpace(path: string) {
  void anur.call("spaces:open", { path });
}

/** The start page's spaces, newest first, each opened with a click. */
export function SpaceList() {
  const spaces = useSpaces(true);
  if (spaces.length === 0) return null;
  return (
    <ul className="space-list" aria-label="Your spaces">
      {spaces.map((v) => (
        <li key={v.path}>
          <button
            type="button"
            className="space-row"
            onClick={() => {
              openSpace(v.path);
            }}
          >
            <span className="space-icon" aria-hidden="true">
              {initial(v.name)}
            </span>
            <span className="space-name">{v.name}</span>
            {v.github ? <span className="space-github">● GitHub</span> : null}
            <span className="space-path">{home(v.path)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The open space's name at the foot of the files panel; a click lists spaces to switch to. */
export function SpaceSwitcher({
  name,
  path,
  onNewSpace,
  onOpenFolder,
}: {
  name: string;
  path: string;
  onNewSpace: () => void;
  onOpenFolder: () => void;
}) {
  const [open, setOpen] = useState(false);
  const spaces = useSpaces(open);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!host.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", away, true);
    return () => {
      window.removeEventListener("pointerdown", away, true);
    };
  }, [open]);
  const close = () => {
    setOpen(false);
  };
  return (
    <div className="space-switcher" ref={host}>
      {open ? (
        <div className="space-menu" role="menu">
          {spaces.map((v) => (
            <button
              key={v.path}
              type="button"
              role="menuitem"
              className={`space-menu-item${v.path === path ? " on" : ""}`}
              title={v.path}
              onClick={() => {
                close();
                if (v.path !== path) openSpace(v.path);
              }}
            >
              <span className="space-icon small" aria-hidden="true">
                {initial(v.name)}
              </span>
              <span className="truncate">{v.name}</span>
            </button>
          ))}
          <div className="space-menu-sep" />
          <button
            type="button"
            role="menuitem"
            className="space-menu-item"
            onClick={() => {
              close();
              onNewSpace();
            }}
          >
            New space…
          </button>
          <button
            type="button"
            role="menuitem"
            className="space-menu-item"
            onClick={() => {
              close();
              onOpenFolder();
            }}
          >
            Open folder as space…
          </button>
          <div className="space-menu-from">
            <OpenFromButtons />
          </div>
        </div>
      ) : null}
      <button
        type="button"
        className="space-current"
        aria-haspopup="menu"
        aria-expanded={open}
        title={path}
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        <span className="space-icon small" aria-hidden="true">
          {initial(name)}
        </span>
        <span className="truncate">{name}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 6.5 5 3.5 8 6.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
    </div>
  );
}
