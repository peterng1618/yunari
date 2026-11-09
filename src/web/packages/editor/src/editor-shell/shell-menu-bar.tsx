import { Menu } from "@base-ui/react/menu";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  ControlIconButton,
  controlIconButtonClass,
} from "../components/ui/control-icon-button.js";
import {
  activeShortcuts,
  subscribeShortcuts,
} from "../shortcut-manager/bindings.js";
import {
  shortcutLabel,
  shortcutSpokenLabel,
} from "../shortcut-manager/display.js";
import type { ProductShortcutId } from "../shortcut-manager/index.js";
import { themeRecents } from "../theme-recents/index.js";
import { uiCopy } from "../ui-copy.js";
import { ControlTooltip } from "./controls/tooltip.js";
import {
  ACTIVATE_THEME_GLYPH,
  EXPORT_THEME_GLYPH,
  EXPORT_WIDGET_GLYPH,
  FIND_GLYPH,
  Glyph,
  IMPORT_THEME_GLYPH,
  type LucideIcon,
  MONITOR_ACTIVITY_GLYPH,
  NEW_THEME_GLYPH,
  OPEN_RECENT_GLYPH,
  OPEN_THEME_GLYPH,
  SAVE_THEME_AS_GLYPH,
  SAVE_THEME_GLYPH,
  TEMPLATE_THEME_GLYPH,
} from "./icons.js";
import type {
  EditorActionFacade,
  EditorViewControls,
} from "./session-facade.js";
import { type SelectionStore, useSelection } from "./shell-stores.js";

/** One header toolbar action: a command the open theme document or the editor
 *  itself owns.
 *
 *  `shortcut` is the `PRODUCT_SHORTCUTS` id whose handler reaches the same
 *  owner the press does. A row with no id prints no chord because the table
 *  binds none for it, not because a toolbar button cannot have one. */
export type ThemeToolbarAction =
  | {
      readonly label: string;
      readonly icon: LucideIcon;
      readonly shortcut?: ProductShortcutId;
      readonly run: (session: EditorActionFacade | undefined) => void;
    }
  | {
      /** The row opens a menu instead of running one command: its items are the
       *  themes the editor has had open, which a command cannot name in
       *  advance. */
      readonly label: string;
      readonly icon: LucideIcon;
      readonly menu: "recentThemes";
    };

/**
 * The toolbar's rows, in order — the one owner of what it draws.
 *
 * **Three groups, split by a divider: the document's lifecycle, its own
 * actions, then the editor's tools.** The Edit and Insert menus are gone
 * because their commands live where they act: a selection's copy, cut,
 * duplicate, delete, group and arrange are the Composition pane's footer
 * toolbar, and everything insertable is the Add pane. Undo and redo remain on
 * their chords and in the `?` sheet. A command changed while designing is one
 * gesture away rather than two, and a glyph with its word as the tooltip and
 * the accessible name is the same control the document actions beside it use.
 */
/**
 * The document's lifecycle, in the order an author meets it: make one, open
 * one, bring one in. "Open" is the library theme, so it leads "Open recent";
 * importing a package also opens a document, so it closes the group.
 */
function openActions(): readonly ThemeToolbarAction[] {
  return [
    {
      label: uiCopy.file.newDocument,
      icon: NEW_THEME_GLYPH,
      shortcut: "file.new",
      run: (session) => void session?.newDocument(),
    },
    {
      label: uiCopy.file.newFromTemplate,
      icon: TEMPLATE_THEME_GLYPH,
      run: (session) => void session?.newFromStarter(),
    },
    {
      label: uiCopy.file.openLibrary,
      icon: OPEN_THEME_GLYPH,
      run: (session) => void session?.openLibrary(),
    },
    {
      label: uiCopy.file.openRecent,
      icon: OPEN_RECENT_GLYPH,
      menu: "recentThemes",
    },
    {
      label: uiCopy.file.importPackage,
      icon: IMPORT_THEME_GLYPH,
      shortcut: "file.open",
      run: (session) => session?.importPackage(),
    },
  ];
}

/** The open document's own actions: keep it, then send it out. */
export const THEME_TOOLBAR_ACTIONS: readonly ThemeToolbarAction[] = [
  {
    label: uiCopy.file.saveLibrary,
    icon: SAVE_THEME_GLYPH,
    shortcut: "file.save",
    run: (session) => void session?.saveLibrary(),
  },
  {
    label: uiCopy.file.saveAs,
    icon: SAVE_THEME_AS_GLYPH,
    run: (session) => void session?.saveAs(),
  },
  {
    label: uiCopy.file.activate,
    icon: ACTIVATE_THEME_GLYPH,
    run: (session) => void session?.activate(),
  },
  {
    label: uiCopy.file.exportTheme,
    icon: EXPORT_THEME_GLYPH,
    run: (session) => void session?.exportTheme(),
  },
  {
    label: uiCopy.file.exportWidget,
    icon: EXPORT_WIDGET_GLYPH,
    run: (session) => void session?.exportWidget(),
  },
];

/** The editor's own browsing tool. It belongs with the view setting rather
 *  than the document's lifecycle: neither makes or keeps a theme. */
function findAssetsAction(onFindAssets: () => void): ThemeToolbarAction {
  return {
    label: uiCopy.file.findAssets,
    icon: FIND_GLYPH,
    shortcut: "file.findAssets",
    run: () => onFindAssets(),
  };
}

/** One toolbar button. `ControlIconButton` is the design's icon button and the
 *  one owner of the label/tooltip pairing; this only hands it the action and
 *  the live chord. */
/** **Open recent**: the themes this editor has had open, newest first, each by
 *  the name it had when it opened. The list is the editor's own store rather
 *  than the library listing — "what did I have open" is not "what is saved" —
 *  and an item reopens through the same named open the store's own route uses,
 *  so the replacement question and the base stay with their owner. */
function OpenRecentMenu({
  action,
  session,
}: {
  readonly action: ThemeToolbarAction;
  readonly session: EditorActionFacade | undefined;
}): React.JSX.Element {
  const recents = useSyncExternalStore(
    themeRecents.subscribe,
    themeRecents.getSnapshot,
  );
  return (
    <Menu.Root>
      <ControlTooltip label={action.label}>
        <Menu.Trigger
          className={`${controlIconButtonClass} text-muted`}
          aria-label={action.label}
          data-yunari-open-recent=""
        >
          <Glyph icon={action.icon} size={15} />
        </Menu.Trigger>
      </ControlTooltip>
      <Menu.Portal keepMounted>
        <Menu.Positioner className="editor-shell-positioner">
          <Menu.Popup className="editor-shell-menu-popup">
            {recents.length === 0 ? (
              <Menu.Item disabled>{uiCopy.library.noRecentThemes}</Menu.Item>
            ) : (
              recents.map((entry) => (
                <Menu.Item
                  key={entry.id}
                  aria-label={entry.name}
                  onClick={() => void session?.openLibraryTheme(entry.id)}
                >
                  {entry.name}
                </Menu.Item>
              ))
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function ToolbarAction({
  action,
  session,
}: {
  readonly action: ThemeToolbarAction;
  readonly session: EditorActionFacade | undefined;
}): React.JSX.Element {
  if ("menu" in action) {
    return <OpenRecentMenu action={action} session={session} />;
  }
  const chord =
    action.shortcut === undefined
      ? undefined
      : {
          printed: shortcutLabel(action.shortcut),
          spoken: shortcutSpokenLabel(action.shortcut),
        };
  return (
    <ControlIconButton
      label={action.label}
      {...(chord === undefined ? {} : { shortcut: chord })}
      onClick={() => action.run(session)}
    >
      <Glyph icon={action.icon} size={15} />
    </ControlIconButton>
  );
}

/** A short rule between groups of commands, so File's functions do not read as
 *  document actions and neither reads as the view setting. */
function ToolbarDivider(): React.JSX.Element {
  return <span className="editor-shell-toolbar-divider" aria-hidden="true" />;
}

export function ShellMenuBar({
  store,
  getView,
  onFindAssets,
}: {
  readonly store: SelectionStore;
  readonly getView: () => EditorViewControls | undefined;
  /** Opens the asset finder. Its modal is the shell's, and the row sits beside
   *  the document actions because the finder is not one theme's command. */
  readonly onFindAssets: () => void;
}): React.JSX.Element {
  const selection = useSelection(store);
  // Subscribed, so a rebind redraws every chord these rows print rather than
  // leaving a mark that runs a different action.
  useSyncExternalStore(subscribeShortcuts, activeShortcuts, activeShortcuts);
  const session = store.bridge?.session;
  const [source, setSource] = useState<"preview" | "live">("preview");

  useEffect(() => {
    setSource(getView()?.sourceMode() ?? "preview");
  }, [getView, selection.selectedCount]);

  const sourceName =
    source === "preview" ? uiCopy.view.preview : uiCopy.view.live;

  return (
    <div
      className="editor-shell-toolbar"
      role="toolbar"
      aria-label={uiCopy.toolbar.label}
      data-yunari-theme-toolbar=""
    >
      {openActions().map((action) => (
        <ToolbarAction key={action.label} action={action} session={session} />
      ))}
      <ToolbarDivider />
      {THEME_TOOLBAR_ACTIONS.map((action) => (
        <ToolbarAction key={action.label} action={action} session={session} />
      ))}
      <ToolbarDivider />
      <ToolbarAction
        action={findAssetsAction(onFindAssets)}
        session={session}
      />
      <ControlIconButton
        label={`${uiCopy.view.dataSource}: ${sourceName}`}
        pressed={source === "live"}
        data={{ "data-yunari-source": "" }}
        onClick={() => {
          const next = source === "preview" ? "live" : "preview";
          getView()?.setSourceMode(next);
          setSource(next);
        }}
      >
        <Glyph icon={MONITOR_ACTIVITY_GLYPH} size={15} />
      </ControlIconButton>
    </div>
  );
}
