import { useEffect, useRef, useState } from "react";
import { anur } from "../bridge.ts";
import { OpenFromButtons } from "./PluginUI.tsx";

/**
 * Vaults (Vaults mock; docs/anur-folder.md): the start page's list of them,
 * and the switcher at the foot of the files panel, as in Obsidian.
 */

type Vault = { path: string; name: string; github: boolean };

function useVaults(open: boolean): Vault[] {
  const [vaults, setVaults] = useState<Vault[]>([]);
  useEffect(() => {
    if (!open) return;
    void anur.call("vaults:list", {}).then((r) => {
      setVaults(r.vaults);
    });
  }, [open]);
  return vaults;
}

const initial = (name: string) => (name.trim()[0] ?? "?").toUpperCase();
const home = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

function openVault(path: string) {
  void anur.call("vaults:open", { path });
}

/** The start page's vaults, newest first, each opened with a click. */
export function VaultList() {
  const vaults = useVaults(true);
  if (vaults.length === 0) return null;
  return (
    <ul className="vault-list" aria-label="Your vaults">
      {vaults.map((v) => (
        <li key={v.path}>
          <button
            type="button"
            className="vault-row"
            onClick={() => {
              openVault(v.path);
            }}
          >
            <span className="vault-icon" aria-hidden="true">
              {initial(v.name)}
            </span>
            <span className="vault-name">{v.name}</span>
            {v.github ? <span className="vault-github">● GitHub</span> : null}
            <span className="vault-path">{home(v.path)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The open vault's name at the foot of the files panel; a click lists vaults to switch to. */
export function VaultSwitcher({
  name,
  path,
  onNewVault,
  onOpenFolder,
}: {
  name: string;
  path: string;
  onNewVault: () => void;
  onOpenFolder: () => void;
}) {
  const [open, setOpen] = useState(false);
  const vaults = useVaults(open);
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
    <div className="vault-switcher" ref={host}>
      {open ? (
        <div className="vault-menu" role="menu">
          {vaults.map((v) => (
            <button
              key={v.path}
              type="button"
              role="menuitem"
              className={`vault-menu-item${v.path === path ? " on" : ""}`}
              title={v.path}
              onClick={() => {
                close();
                if (v.path !== path) openVault(v.path);
              }}
            >
              <span className="vault-icon small" aria-hidden="true">
                {initial(v.name)}
              </span>
              <span className="truncate">{v.name}</span>
            </button>
          ))}
          <div className="vault-menu-sep" />
          <button
            type="button"
            role="menuitem"
            className="vault-menu-item"
            onClick={() => {
              close();
              onNewVault();
            }}
          >
            New vault…
          </button>
          <button
            type="button"
            role="menuitem"
            className="vault-menu-item"
            onClick={() => {
              close();
              onOpenFolder();
            }}
          >
            Open folder as vault…
          </button>
          <div className="vault-menu-from">
            <OpenFromButtons />
          </div>
        </div>
      ) : null}
      <button
        type="button"
        className="vault-current"
        aria-haspopup="menu"
        aria-expanded={open}
        title={path}
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        <span className="vault-icon small" aria-hidden="true">
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
