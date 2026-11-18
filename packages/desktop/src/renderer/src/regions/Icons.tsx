/** Line icons drawn at 16px with the current text colour. */
type IconProps = { label?: string };

function Svg({ label, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className="icon"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {children}
    </svg>
  );
}

export const FolderIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M1.75 4.25a1 1 0 0 1 1-1h3.1l1.4 1.5h5.99a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z" />
  </Svg>
);

export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="4.25" />
    <path d="m10.25 10.25 3.5 3.5" />
  </Svg>
);

export const PluginsIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.25" y="2.25" width="4.5" height="4.5" rx="1" />
    <rect x="9.25" y="2.25" width="4.5" height="4.5" rx="1" />
    <rect x="2.25" y="9.25" width="4.5" height="4.5" rx="1" />
    <path d="M11.5 9.25v4.5M9.25 11.5h4.5" />
  </Svg>
);

/** A gear, as settings look everywhere (Lucide's, drawn on 24 and scaled to 16). */
export const SettingsIcon = (p: IconProps) => (
  <Svg {...p}>
    <g transform="scale(0.6667)" strokeWidth="2.1">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </g>
  </Svg>
);

export const BackIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 8H3.5M7 4.5 3.5 8 7 11.5" />
  </Svg>
);

export const ForwardIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8h9.5M9 4.5 12.5 8 9 11.5" />
  </Svg>
);

export const LinkIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.75 9.25a2.5 2.5 0 0 0 3.54 0l2.12-2.12a2.5 2.5 0 0 0-3.54-3.54l-.7.7M9.25 6.75a2.5 2.5 0 0 0-3.54 0L3.59 8.87a2.5 2.5 0 0 0 3.54 3.54l.7-.7" />
  </Svg>
);

export const MoreIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="3.5" cy="8" r=".6" fill="currentColor" />
    <circle cx="8" cy="8" r=".6" fill="currentColor" />
    <circle cx="12.5" cy="8" r=".6" fill="currentColor" />
  </Svg>
);

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3v10M3 8h10" />
  </Svg>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m4 6.25 4 4 4-4" />
  </Svg>
);

export const SidebarLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
    <path d="M6 2.75v10.5" />
  </Svg>
);

export const SidebarRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
    <path d="M10 2.75v10.5" />
  </Svg>
);

/** A close or dismiss cross, drawn so it sits in the middle of its button. */
export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.75 4.75l6.5 6.5M11.25 4.75l-6.5 6.5" />
  </Svg>
);

/** Collapse all: two chevrons folding toward the middle. */
export const CollapseAllIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 2.75l3 3 3-3M5 13.25l3-3 3 3" />
  </Svg>
);

export const DocIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 1.75h5.25L12.5 5v9.25H4z" />
    <path d="M9 1.75V5h3.5" />
  </Svg>
);

export const NewDocIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 1.75h5.25L12.5 5v9.25H4z" />
    <path d="M8.25 7.5v4M6.25 9.5h4" />
  </Svg>
);

export const NewFolderIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M1.75 4.25a1 1 0 0 1 1-1h3.1l1.4 1.5h5.99a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z" />
    <path d="M8 7.25v4M6 9.25h4" />
  </Svg>
);

export const SortIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 2.5v11M2.5 11.5l2 2 2-2M9.5 4h4.5M9.5 8h3.5M9.5 12h2" />
  </Svg>
);

/** Anur's mark, the app icon's rounded diamond: the agent, on the whole doc. */
export const AnurIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect
      x="4.2"
      y="4.2"
      width="7.6"
      height="7.6"
      rx="1.6"
      transform="rotate(45 8 8)"
      fill="currentColor"
      stroke="none"
    />
  </Svg>
);
