import { Menu } from "@base-ui/react/menu";
import {
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ControlIconButton,
  useControlTooltip,
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
import { uiCopy } from "../ui-copy.js";
import {
  ACTIVATE_THEME_GLYPH,
  CHECK_GLYPH,
  EXPORT_THEME_GLYPH,
  FILE_MENU_GLYPH,
  Glyph,
  IMPORT_THEME_GLYPH,
  type LucideIcon,
  OPEN_THEME_GLYPH,
  SAVE_THEME_AS_GLYPH,
  SAVE_THEME_GLYPH,
  VIEW_MENU_GLYPH,
} from "./icons.js";
import type {
  EditorActionFacade,
  EditorViewControls,
} from "./session-facade.js";
import { type SelectionStore, useSelection } from "./shell-stores.js";

function MenuGroup({
  label,
  icon,
  children,
}: {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly children: ReactNode;
}): React.JSX.Element {
  const ref = useRef<HTMLButtonElement>(null);
  // The glyph is the whole visible control, so the tooltip and the accessible
  // name are the menu's one word, mounted through the control set's one owner.
  useControlTooltip(ref, label);
  return (
    <Menu.Root>
      <Menu.Trigger
        ref={ref}
        aria-label={label}
        className="editor-shell-menubar-icon"
      >
        <Glyph icon={icon} size={15} />
      </Menu.Trigger>
      <Menu.Portal>
        {/* Base UI centres a positioned popup on its trigger by default, which
            floats the menu over the middle of its own label; a menu belongs at
            the trigger's start edge, which is the idiom the colour picker
            already uses (`components/ui/colour-picker.tsx`). */}
        <Menu.Positioner align="start" className="editor-shell-positioner">
          <Menu.Popup className="editor-shell-menu-popup">
            {children}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** The tick a checked radio choice carries, reserving its width whether or not
 *  it is showing so the labels either side of it do not shift as the setting
 *  changes. */
const checkSlot = (state: {
  readonly checked: boolean;
}): React.CSSProperties => ({
  display: "inline-block",
  width: 13,
  visibility: state.checked ? "visible" : "hidden",
});

/** One View setting as a submenu of its own values.
 *
 *  These were items that flipped a boolean on click, which read as settings
 *  and behaved as switches: nothing on screen said the other value existed, one
 *  mis-click replaced the preview with a reading that then looked hung, and no
 *  `aria-checked` meant a screen reader heard a plain menu item and never which
 *  state was current.
 *  The zoom badge beside them is the idiom already in this shell — a trigger
 *  naming the current value, a popup listing every one — and the trigger's
 *  `aria-haspopup` is what now distinguishes the two.
 *
 *  The choices stay open after one is picked, so the tick can be seen moving and
 *  the other value is still one gesture away rather than a reopen.
 */
function ViewSetting<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly (readonly [T, string])[];
  readonly onChange: (next: T) => void;
}): React.JSX.Element {
  const current = options.find(([id]) => id === value)?.[1] ?? "";
  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger>{`${label}: ${current}`}</Menu.SubmenuTrigger>
      <Menu.Portal>
        {/* A submenu opens beside its item and lines its top up with it, so it
            takes the same start alignment as the menubar's own menus. */}
        <Menu.Positioner align="start" className="editor-shell-positioner">
          <Menu.Popup className="editor-shell-menu-popup">
            <Menu.RadioGroup value={value} onValueChange={onChange}>
              {options.map(([id, text]) => (
                <Menu.RadioItem key={id} value={id}>
                  <Menu.RadioItemIndicator keepMounted style={checkSlot}>
                    <Glyph icon={CHECK_GLYPH} size={12} />
                  </Menu.RadioItemIndicator>
                  {text}
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.SubmenuRoot>
  );
}

/** One header toolbar action: the open theme document's own commands.
 *
 *  `shortcut` is the `PRODUCT_SHORTCUTS` id whose handler reaches the same
 *  owner the press does — Import theme and Save. The rest carry none because
 *  the table binds none for them, not because a toolbar button cannot have
 *  one. */
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
 * insertable is the Add pane. An Insert menu never existed in this header
 * (`DESIGN.md`). Edit existed and duplicated that footer, so it went the way of
 * the Arrange menu before it. Undo and redo remain on their chords and in the
 * `?` sheet.
 *
 * **File and View stay menus** because their remaining rows are functions with
 * no other home: New, New from template, Find assets, Open recent, and the
 * readings source.
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

export function ShellMenuBar({
  store,
  getView,
  onFindAssets,
}: {
  readonly store: SelectionStore;
  readonly getView: () => EditorViewControls | undefined;
  /** Opens the asset finder. Its modal is the shell's, and the row sits in the
   *  File menu because the finder is not one theme document's action. */
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

  const item = (
    label: string,
    run: () => void,
    disabled = false,
    shortcut?: ProductShortcutId,
  ) => (
    <Menu.Item key={label} disabled={disabled} onClick={run}>
      {label}
      {/* Inline and right-aligned rather than a tooltip: that is the reading a
          menu row has had in every application the author has used, and a popup
          over the row it describes would cover the menu. */}
      {shortcut === undefined ? null : (
        <kbd
          className="editor-shell-menu-key"
          aria-label={shortcutSpokenLabel(shortcut)}
        >
          {shortcutLabel(shortcut)}
        </kbd>
      )}
    </Menu.Item>
  );

  return (
    <>
      <nav className="editor-shell-menubar" aria-label={uiCopy.menus.label}>
        <MenuGroup label={uiCopy.menus.file} icon={FILE_MENU_GLYPH}>
          {/* A File row prints a chord where the row and its
              `PRODUCT_SHORTCUTS` id run the same call — `item`'s fourth
              argument. `newFromTemplate` and `openRecent` carry none because
              the table binds nothing for them, not because a File row cannot
              have one. */}
          {/* `file.new` → `#document.newDocument()`. */}
          {item(
            uiCopy.file.newDocument,
            () => void session?.newDocument(),
            false,
            "file.new",
          )}
          {item(
            uiCopy.file.newFromTemplate,
            () => void session?.newFromStarter(),
          )}
          {item(uiCopy.file.findAssets, onFindAssets, false, "file.findAssets")}
          {/* The newest stored theme that is not this one. A menu row rather
              than a toolbar button: the toolbar's **Open** already opens the
              chooser, and this is the shortcut past it. */}
          {item(uiCopy.file.openRecent, () => void session?.openRecent())}
          {/* The selected unit as a package. It is done to what is on the
              canvas, so it belongs beside the rows that read the open document
              rather than on the toolbar, which carries theme-document actions
              and no selection command. */}
          {item(uiCopy.file.exportWidget, () => session?.exportWidget())}
        </MenuGroup>
        <MenuGroup label={uiCopy.menus.view} icon={VIEW_MENU_GLYPH}>
          <ViewSetting
            label={uiCopy.view.dataSource}
            value={source}
            options={[
              ["preview", uiCopy.view.preview],
              ["live", uiCopy.view.live],
            ]}
            onChange={(next) => {
              getView()?.setSourceMode(next);
              setSource(next);
            }}
          />
        </MenuGroup>
      </nav>
      <div
        className="editor-shell-toolbar"
        role="toolbar"
        aria-label={uiCopy.toolbar.label}
        data-yunari-theme-toolbar=""
      >
        {THEME_TOOLBAR_ACTIONS.map((action) => (
          <ToolbarAction key={action.label} action={action} session={session} />
        ))}
      </div>
    </>
  );
}
