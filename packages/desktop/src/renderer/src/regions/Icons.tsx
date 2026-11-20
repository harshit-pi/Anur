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

/** Repos as boxes, one holding more: the system map (group 20). */
export const SystemIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="1.75" y="2.25" width="5" height="4" rx="1" />
    <rect x="9.25" y="2.25" width="5" height="4" rx="1" />
    <rect x="1.75" y="9.25" width="12.5" height="4.5" rx="1" />
    <path d="M4.5 11.5h2M9.5 11.5h2" />
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

/** Anur's mark, the app icon's rounded diamond, about as wide as the marks beside it. */
export const AnurIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect
      x="2.7"
      y="2.7"
      width="10.6"
      height="10.6"
      rx="2.2"
      transform="rotate(45 8 8)"
      fill="currentColor"
      stroke="none"
    />
  </Svg>
);

/** GitHub's mark (Simple Icons), filled, scaled from 24 to 16. */
export const GitHubIcon = (p: IconProps) => (
  <Svg {...p}>
    <path
      transform="scale(0.6667)"
      fill="currentColor"
      stroke="none"
      d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
    />
  </Svg>
);
