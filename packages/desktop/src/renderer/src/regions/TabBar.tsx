import { Fragment, useEffect, useRef, useState, type PointerEvent } from "react";
import type { MenuEntry } from "../../../shared/ipc-contract.ts";
import { anur } from "../bridge.ts";
import {
  GROUP_COLORS,
  close,
  closeGroup,
  closeOthers,
  closeToRight,
  docOf,
  foldGroup,
  groupOf,
  isShown,
  joinGroup,
  leaveGroup,
  move,
  newGroup,
  newTabInGroup,
  setPinned,
  titleOf,
  ungroup,
  updateGroup,
  type Group,
  type Tab,
  type Tabs,
} from "../layout/tabs.ts";
import {
  ChevronDownIcon,
  CloseIcon,
  DocIcon,
  PlusIcon,
  SidebarLeftIcon,
  SidebarRightIcon,
} from "./Icons.tsx";

const COLOR_NAMES: Record<Group["color"], string> = {
  blue: "Blue",
  green: "Green",
  amber: "Amber",
  red: "Red",
  slate: "Slate",
};

/** A drag under way: the tab, how far it has moved, and the tab it would land before. */
type Drag = {
  id: string;
  startX: number;
  dx: number;
  before: string | null;
  /** The group under the dragged tab, null over an ungrouped tab, undefined in a gap. */
  over: string | null | undefined;
  moved: boolean;
};

/**
 * 3. Tab bar: the files toggle, tabs, then Page and Map, and the section
 * panel toggle. Tabs drag to move, pin to the left, and gather in groups.
 */
export function TabBar({
  open,
  onToggle,
  tabs,
  onChange,
  onSelectTab,
  onNewTab,
  onListTabs,
  view,
  onView,
}: {
  open: Record<"left" | "right", boolean>;
  onToggle: (side: "left" | "right") => void;
  tabs: Tabs;
  onChange: (change: (t: Tabs) => Tabs) => void;
  onSelectTab: (id: string) => void;
  onNewTab: () => void;
  onListTabs: () => void;
  /** Page or Map; null while no doc is open. */
  view: "page" | "map" | null;
  onView: (view: "page" | "map") => void;
}) {
  const active = tabs.active;
  // ⌄ shows once the tabs no longer fit.
  const strip = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const check = () => {
      setOverflowing(el.scrollWidth > el.clientWidth + 1);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [tabs.tabs.length, tabs.groups]);
  // The active tab scrolls into view, as after ⌃Tab or picking from ⌄.
  useEffect(() => {
    strip.current
      ?.querySelector(".tab.active")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  const startDrag = (e: PointerEvent<HTMLDivElement>, id: string) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".tab-close")) return;
    setDrag({ id, startX: e.clientX, dx: 0, before: null, over: undefined, moved: false });
  };
  const dragMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    if (!drag.moved && Math.abs(dx) < 4) return;
    // Captured only once it moves, so a plain click still reaches the title.
    if (!drag.moved) e.currentTarget.setPointerCapture(e.pointerId);
    const node = e.currentTarget.getBoundingClientRect();
    // The tab's resting centre plus how far it has moved.
    const centre = node.left - drag.dx + dx + node.width / 2;
    const pinned = tabs.tabs.find((x) => x.id === drag.id)?.pinned ?? false;
    const others = [...(strip.current?.querySelectorAll<HTMLElement>(".tab") ?? [])].filter(
      (n) =>
        n.dataset.id !== drag.id &&
        Boolean(tabs.tabs.find((x) => x.id === n.dataset.id)?.pinned) === pinned,
    );
    const before = others.find((n) => {
      const r = n.getBoundingClientRect();
      return centre < r.left + r.width / 2;
    });
    // What sits under the dragged tab's centre decides its group.
    const hit = [...(strip.current?.querySelectorAll<HTMLElement>(".tab, .group-chip") ?? [])].find(
      (n) => {
        if (n.dataset.id === drag.id) return false;
        const r = n.getBoundingClientRect();
        return centre >= r.left && centre <= r.right;
      },
    );
    const over = pinned ? null : hit ? (hit.dataset.group ?? null) : undefined;
    setDrag({ ...drag, dx, moved: true, before: before?.dataset.id ?? null, over });
  };
  const endDrag = () => {
    if (!drag) return;
    setDrag(null);
    if (!drag.moved) return;
    onChange((t) => move(t, drag.id, drag.before, drag.over));
    onSelectTab(drag.id);
  };

  const tabMenu = (tab: Tab) => {
    const others = tabs.groups.filter((g) => g.id !== tab.group);
    const items: MenuEntry[] = [
      { id: "pin", label: tab.pinned ? "Unpin tab" : "Pin tab" },
      { separator: true },
      ...(tab.pinned
        ? []
        : [
            { id: "new-group", label: "Add to new group" },
            ...(others.length
              ? [
                  {
                    label: "Add to group",
                    submenu: others.map((g) => ({
                      id: `join:${g.id}`,
                      label: g.name || `${COLOR_NAMES[g.color]} group`,
                    })),
                  },
                ]
              : []),
          ]),
      ...(tab.group ? [{ id: "leave", label: "Remove from group" }] : []),
      ...(tab.pinned ? [] : [{ separator: true as const }]),
      { id: "close", label: "Close tab" },
      { id: "close-others", label: "Close other tabs" },
      { id: "close-right", label: "Close tabs to the right" },
    ];
    void anur.call("menu:popup", { items }).then(({ id }) => {
      if (id === "pin") onChange((t) => setPinned(t, tab.id, !tab.pinned));
      else if (id === "new-group") {
        const made = newGroup(tabs, tab.id);
        onChange(() => made.tabs);
        setNaming(made.group);
      } else if (id?.startsWith("join:")) onChange((t) => joinGroup(t, tab.id, id.slice(5)));
      else if (id === "leave") onChange((t) => leaveGroup(t, tab.id));
      else if (id === "close") onChange((t) => close(t, tab.id));
      else if (id === "close-others") onChange((t) => closeOthers(t, tab.id));
      else if (id === "close-right") onChange((t) => closeToRight(t, tab.id));
    });
  };

  const groupMenu = (group: Group) => {
    const items: MenuEntry[] = [
      { id: "rename", label: group.name ? "Rename group" : "Name group" },
      {
        label: "Colour",
        submenu: GROUP_COLORS.map((c) => ({
          id: `color:${c}`,
          label: COLOR_NAMES[c],
          checked: c === group.color,
        })),
      },
      { separator: true },
      { id: "new-tab", label: "New tab in group" },
      { id: "fold", label: group.folded ? "Show group" : "Fold group" },
      { id: "ungroup", label: "Ungroup" },
      { id: "close", label: "Close group" },
    ];
    void anur.call("menu:popup", { items }).then(({ id }) => {
      if (id === "rename") setNaming(group.id);
      else if (id?.startsWith("color:")) {
        const color = GROUP_COLORS.find((c) => c === id.slice(6));
        if (color) onChange((t) => updateGroup(t, group.id, { color }));
      } else if (id === "new-tab") onChange((t) => newTabInGroup(t, group.id));
      else if (id === "fold") onChange((t) => foldGroup(t, group.id, !group.folded));
      else if (id === "ungroup") onChange((t) => ungroup(t, group.id));
      else if (id === "close") onChange((t) => closeGroup(t, group.id));
    });
  };

  const draggingPinned = drag ? tabs.tabs.find((x) => x.id === drag.id)?.pinned : undefined;
  return (
    <header className="tab-bar" aria-label="Tabs">
      <button
        className="icon-button"
        type="button"
        aria-label={open.left ? "Hide the files panel" : "Show the files panel"}
        aria-pressed={open.left}
        title={open.left ? "Hide files (⌘\\)" : "Show files (⌘\\)"}
        onClick={() => {
          onToggle("left");
        }}
      >
        <SidebarLeftIcon />
      </button>
      <div className="tabs" role="tablist" aria-label="Open docs">
        <div className="tab-strip" ref={strip}>
          {tabs.tabs.length === 0 ? <span className="quiet tab-empty">No docs open</span> : null}
          {tabs.tabs.map((t, i) => {
            const prev = tabs.tabs[i - 1];
            const next = tabs.tabs[i + 1];
            const group = groupOf(tabs, t);
            const startsGroup = group && prev?.group !== t.group;
            const endsGroup = group && next?.group !== t.group;
            const title = titleOf(t);
            const dropHere = drag?.moved && drag.before === t.id && draggingPinned === t.pinned;
            return (
              <Fragment key={t.id}>
                {prev?.pinned && !t.pinned ? <span className="pin-rule" /> : null}
                {startsGroup ? (
                  <GroupChip
                    group={group}
                    count={tabs.tabs.filter((x) => x.group === group.id).length}
                    naming={naming === group.id}
                    target={Boolean(drag?.moved && drag.over === group.id)}
                    onToggle={() => {
                      onChange((x) => foldGroup(x, group.id, !group.folded));
                    }}
                    onMenu={() => {
                      groupMenu(group);
                    }}
                    onName={(name) => {
                      onChange((x) => updateGroup(x, group.id, { name }));
                    }}
                    onNamed={() => {
                      setNaming(null);
                    }}
                  />
                ) : null}
                {isShown(tabs, t) ? (
                  <div
                    role="tab"
                    data-id={t.id}
                    data-group={t.group}
                    aria-selected={t.id === active}
                    className={[
                      "tab",
                      t.id === active ? "active" : "",
                      t.pinned ? "pinned" : "",
                      group ? `in-group group-${group.color}` : "",
                      endsGroup ? "group-end" : "",
                      drag?.moved && drag.id === t.id ? "dragging" : "",
                      dropHere ? "drop-before" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={
                      drag?.moved && drag.id === t.id
                        ? { transform: `translateX(${String(drag.dx)}px)` }
                        : undefined
                    }
                    title={t.pinned ? `${title} (pinned)` : (docOf(t) ?? "New tab")}
                    onPointerDown={(e) => {
                      startDrag(e, t.id);
                    }}
                    onPointerMove={dragMove}
                    onPointerUp={endDrag}
                    onPointerCancel={() => {
                      setDrag(null);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      tabMenu(t);
                    }}
                    onMouseDown={(e) => {
                      // Middle-click closes, as in a browser.
                      if (e.button === 1) {
                        e.preventDefault();
                        onChange((x) => close(x, t.id));
                      }
                    }}
                  >
                    {t.pinned ? <DocIcon /> : null}
                    <button
                      type="button"
                      className="tab-title truncate"
                      aria-label={t.pinned ? title : undefined}
                      onClick={() => {
                        onSelectTab(t.id);
                      }}
                    >
                      {t.pinned ? null : title}
                    </button>
                    {t.pinned ? null : (
                      <button
                        type="button"
                        className="tab-close"
                        aria-label={`Close ${title}`}
                        title="Close tab (⌘W)"
                        onClick={() => {
                          onChange((x) => close(x, t.id));
                        }}
                      >
                        <CloseIcon />
                      </button>
                    )}
                  </div>
                ) : null}
              </Fragment>
            );
          })}
          {drag?.moved && drag.before === null ? <span className="drop-end" /> : null}
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="New tab"
          title="New tab (⌘T)"
          onClick={onNewTab}
        >
          <PlusIcon />
        </button>
        {overflowing ? (
          <button
            className="icon-button"
            type="button"
            aria-label="List all tabs"
            title="List all tabs"
            onClick={onListTabs}
          >
            <ChevronDownIcon />
          </button>
        ) : null}
      </div>
      <div className="segmented" role="radiogroup" aria-label="View">
        {(["page", "map"] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={view === v}
            className={view === v ? "segment selected" : "segment"}
            disabled={view === null}
            title={v === "page" ? "Page (⇧⌘M)" : "Map (⇧⌘M)"}
            onClick={() => {
              onView(v);
            }}
          >
            {v === "page" ? "Page" : "Map"}
          </button>
        ))}
      </div>
      {/* Ask, the whole-doc thread, comes back here with task 4.8. */}
      <button
        className="icon-button"
        type="button"
        aria-label={open.right ? "Hide the section panel" : "Show the section panel"}
        aria-pressed={open.right}
        title={open.right ? "Hide the section panel (⌥⌘\\)" : "Show the section panel (⌥⌘\\)"}
        onClick={() => {
          onToggle("right");
        }}
      >
        <SidebarRightIcon />
      </button>
    </header>
  );
}

/** A group's name: a click folds or shows its tabs; folded, it shows how many. */
function GroupChip({
  group,
  count,
  naming,
  target,
  onToggle,
  onMenu,
  onName,
  onNamed,
}: {
  group: Group;
  count: number;
  naming: boolean;
  /** A dragged tab would join this group. */
  target: boolean;
  onToggle: () => void;
  onMenu: () => void;
  onName: (name: string) => void;
  onNamed: () => void;
}) {
  const className = `group-chip group-${group.color}${group.name ? "" : " unnamed"}${target ? " drop-target" : ""}`;
  if (naming) {
    return (
      <input
        className={`${className} naming`}
        aria-label="Group name"
        placeholder="Name"
        maxLength={60}
        autoFocus
        defaultValue={group.name}
        size={Math.max(4, group.name.length + 1)}
        onChange={(e) => {
          e.currentTarget.size = Math.max(4, e.currentTarget.value.length + 1);
        }}
        onBlur={(e) => {
          onName(e.currentTarget.value.trim());
          onNamed();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            e.currentTarget.value = group.name;
            e.currentTarget.blur();
          }
        }}
      />
    );
  }
  const label = group.name || `${COLOR_NAMES[group.color]} group`;
  return (
    <button
      type="button"
      data-group={group.id}
      className={`${className}${group.folded ? " folded" : ""}`}
      aria-expanded={!group.folded}
      aria-label={`${label}, ${String(count)} ${count === 1 ? "tab" : "tabs"}`}
      title={group.folded ? "Show this group" : "Fold this group"}
      onClick={onToggle}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu();
      }}
    >
      {group.name}
      {group.folded ? <span className="group-count">{count}</span> : null}
    </button>
  );
}
