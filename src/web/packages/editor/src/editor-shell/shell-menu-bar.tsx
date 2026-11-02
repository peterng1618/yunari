import { useEffect, useState, useSyncExternalStore } from "react";
import { ControlIconButton } from "../components/ui/control-icon-button.js";
import {
  activeShortcuts,
  subscribeShortcuts,
} from "../shortcut-manager/bindings.js";
import {
  shortcutLabel,
  shortcutSpokenLabel,
} from "../shortcut-manager/display.js";
import type { ProductShortcutId } from "../shortcut-manager/index.js";
import { uiCopy } from "../ui-copy.js";
import {
  ACTIVATE_THEME_GLYPH,
  EXPORT_THEME_GLYPH,
  EXPORT_WIDGET_GLYPH,
  FIND_GLYPH,
  Glyph,
  IMPORT_THEME_GLYPH,
  type LucideIcon,
  NEW_THEME_GLYPH,
  OPEN_RECENT_GLYPH,
  OPEN_THEME_GLYPH,
  READINGS_GLYPH,
  SAVE_THEME_AS_GLYPH,
  SAVE_THEME_GLYPH,
  TEMPLATE_THEME_GLYPH,
  VISIBLE_GLYPH,
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
export interface ThemeToolbarAction {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly shortcut?: ProductShortcutId;
  readonly run: (session: EditorActionFacade | undefined) => void;
}

/**
 * The toolbar's rows, in order — the one owner of what it draws.
 *
 * **Document actions only.** The Edit and Insert menus are gone because their
 * commands live where they act: a selection's copy, cut, duplicate, delete,
 * group and arrange are the Composition pane's footer toolbar, and everything
 * insertable is the Add pane. Undo and redo remain on their chords and in the
 * `?` sheet.
 *
 * **File's functions and the View setting are rows here.** A command changed
 * while designing is one gesture away rather than two, and a glyph with its word
 * as the tooltip and the accessible name is the same control the document
 * actions beside it use. The dividers keep File's functions, the document's own
 * actions and the view setting distinct.
 */
export const THEME_TOOLBAR_ACTIONS: readonly ThemeToolbarAction[] = [
  {
    label: uiCopy.file.importPackage,
    icon: IMPORT_THEME_GLYPH,
    shortcut: "file.open",
    run: (session) => session?.importPackage(),
  },
  {
    label: uiCopy.file.openLibrary,
    icon: OPEN_THEME_GLYPH,
    run: (session) => void session?.openLibrary(),
  },
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
];

/** File's functions, in the order the header draws them. */
function fileActions(onFindAssets: () => void): readonly ThemeToolbarAction[] {
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
      label: uiCopy.file.findAssets,
      icon: FIND_GLYPH,
      shortcut: "file.findAssets",
      run: () => onFindAssets(),
    },
    {
      label: uiCopy.file.openRecent,
      icon: OPEN_RECENT_GLYPH,
      run: (session) => void session?.openRecent(),
    },
    {
      label: uiCopy.file.exportWidget,
      icon: EXPORT_WIDGET_GLYPH,
      run: (session) => session?.exportWidget(),
    },
  ];
}

/** One toolbar button. `ControlIconButton` is the design's icon button and the
 *  one owner of the label/tooltip pairing; this only hands it the action and
 *  the live chord. */
function ToolbarAction({
  action,
  session,
}: {
  readonly action: ThemeToolbarAction;
  readonly session: EditorActionFacade | undefined;
}): React.JSX.Element {
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
      {fileActions(onFindAssets).map((action) => (
        <ToolbarAction key={action.label} action={action} session={session} />
      ))}
      <ToolbarDivider />
      {THEME_TOOLBAR_ACTIONS.map((action) => (
        <ToolbarAction key={action.label} action={action} session={session} />
      ))}
      <ToolbarDivider />
      <ControlIconButton
        label={`${uiCopy.view.dataSource}: ${sourceName}`}
        data={{ "data-yunari-source": "" }}
        onClick={() => {
          const next = source === "preview" ? "live" : "preview";
          getView()?.setSourceMode(next);
          setSource(next);
        }}
      >
        <Glyph
          icon={source === "preview" ? VISIBLE_GLYPH : READINGS_GLYPH}
          size={15}
        />
      </ControlIconButton>
    </div>
  );
}
