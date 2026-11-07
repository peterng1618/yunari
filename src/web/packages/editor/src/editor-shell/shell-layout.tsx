import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import type { ListingCategory } from "@yunari/renderer-core";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { AssetFinder } from "../asset-finder/modal.js";
import { hitTargetClasses } from "../components/ui/control-well.js";
import {
  readPreviewRatioTokens,
  setActivePreviewRatios,
} from "../display-lens.js";
import { IndicatorOverlay } from "../indicator-manager/cursor-indicator.js";
import { IndicatorStore } from "../indicator-manager/store.js";
import { CompositionPane } from "../panes/composition/composition-pane.js";
import type { SettingsPage } from "../settings-mode/nav.js";
import {
  SettingsRegion,
  type SettingsStatusLine,
} from "../settings-mode/region.js";
import {
  readShortcutOverrides,
  resolveShortcuts,
  type ShortcutOverrides,
  setActiveShortcuts,
} from "../shortcut-manager/bindings.js";
import { StoreHalves } from "../store-mode/halves.js";
import type { StoreTab } from "../store-mode/region.js";
import { StoreModeRegion } from "../store-mode/region.js";
import { uiCopy } from "../ui-copy.js";
import { activeWidgetUnits, subscribeWidgetUnits } from "../widget-packs.js";
import { BackgroundPlayback } from "./background-playback.js";
import type { EditorShellBridge } from "./bridge.js";
import { CanvasContextMenu } from "./canvas-context-menu.js";
import { CanvasDock } from "./canvas-dock.js";
import { ControlTooltip } from "./controls/tooltip.js";
import { DiagnosticMessage } from "./diagnostic-message.js";
import { DisplaySwitch } from "./display-switch.js";
import { DocumentIdentity } from "./document-identity.js";
import { HostingStore } from "./hosting-store.js";
import {
  EDITOR_MODE_GLYPH,
  Glyph,
  INSPECTOR_COLLAPSE_GLYPH,
  INSPECTOR_EXPAND_GLYPH,
  type LucideIcon,
  RAIL_GLYPHS,
  SETTINGS_GLYPH,
  THEMES_MODE_GLYPH,
} from "./icons.js";
import { LayerActions } from "./layer-panel.js";
import {
  applyShellPalette,
  prefersDarkAppearance,
  readShellChoice,
  resolveShellPalette,
  systemShellPalette,
  watchSystemAppearance,
} from "./palette.js";
import { Pane } from "./pane.js";
import { PublishControl } from "./publish-control.js";
import { PublishIndicator } from "./publish-indicator.js";
import { Rail, type RailSlot } from "./rail.js";
import { SaveState } from "./save-state.js";
import type { EditorViewControls } from "./session-facade.js";
import { parseShellEntry } from "./shell-entry.js";
import { ShellMenuBar } from "./shell-menu-bar.js";
import {
  FinderStore,
  PaneRequestStore,
  PublishSurfaceStore,
  SelectionStore,
  SheetStore,
  StatusMessageStore,
  TokenSelectionStore,
  useFinder,
  usePaneRequest,
  useSelection,
  useSheet,
} from "./shell-stores.js";
import { ShortcutReference } from "./shortcut-reference.js";
import { StatusMessage } from "./status-message.js";
import { StatusReadout } from "./status-readout.js";

/**
 * The shell's three surfaces. `editor` owns the document and the canvas; the
 * other two own no canvas at all, and each renders its own region in the
 * content area instead of the editor's body.
 *
 * It is a mode and not a route: nothing persists it, nothing outside the shell
 * reads it, and the store mode is a surface in this same React tree rather than
 * an iframe over another page.
 */
export type ShellMode = "editor" | "themes" | "settings";

/**
 * What the shell's React root is given: the surface showing, and the request for
 * another one.
 *
 * The mode is a prop rather than state inside `Shell` so the region a later task
 * hangs here reads the answer from one owner — `ShellRoot` below holds the mode
 * and the one guard in front of it — instead of each region keeping its own copy
 * of which surface is showing.
 */
export interface ShellLayoutProps {
  readonly mode: ShellMode;
  readonly onModeChange: (mode: ShellMode) => void;
}

/** Each mode's name, as a **total** lookup: a `ShellMode` added to the union
 *  without a label fails to compile here, rather than rendering a segment with
 *  no name. `satisfies` could not make that claim — it validated the entries
 *  that existed, not that they covered the union. */
const MODE_NAMES: Record<ShellMode, string> = {
  editor: uiCopy.modes.editor,
  themes: uiCopy.modes.themes,
  settings: uiCopy.modes.settings,
};

/** The order the header draws them in, which is a separate decision from what
 *  each is called. The store leads because it is the surface a session starts
 *  from; the editor is where a theme is made, and Settings stays last. */
const MODE_ORDER = [
  "themes",
  "editor",
  "settings",
] as const satisfies readonly ShellMode[];

/** One glyph per mode, in the header's own icon vocabulary. */
const MODE_GLYPHS: Record<ShellMode, LucideIcon> = {
  editor: EDITOR_MODE_GLYPH,
  themes: THEMES_MODE_GLYPH,
  settings: SETTINGS_GLYPH,
};

/** The switch's id, and the stem of each segment's. The control-id rule wants every
 *  control to carry an id; the segment's is derived from the mode the way
 *  `useControlIds` derives one from the control it names. */
const MODE_SWITCH_ID = "yunari-shell-modes";

const modeSegmentId = (mode: ShellMode): string => `${MODE_SWITCH_ID}-${mode}`;

/**
 * The design's Segmented, in the header's **bare** form.
 *
 * The one Segmented component (`components/ui/control-segmented.tsx`) is a
 * labelled *row* — the 74px label column beside a value cell — and the header
 * draws this one as a well
 * with the three names in it and no label at all, so the group is its own
 * label and the primitive is composed here rather than the row vocabulary
 * growing a fourth shape for one caller.
 *
 * The chosen item is lifted to `--stage` with `--text` — the shared chosen
 * treatment, never an accent fill: the palette allows one accent-filled element per
 * region and the header's is the publish control.
 */
function ModeSwitch(props: ShellLayoutProps): React.JSX.Element {
  return (
    <ToggleGroup
      id={MODE_SWITCH_ID}
      className="editor-shell-mode-switch"
      value={[props.mode]}
      aria-label={uiCopy.modes.label}
      onValueChange={(next) => {
        const chosen = next[0];
        if (chosen !== undefined) props.onModeChange(chosen as ShellMode);
      }}
    >
      {MODE_ORDER.map((mode) => (
        <Toggle
          key={mode}
          id={modeSegmentId(mode)}
          value={mode}
          className={hitTargetClasses}
        >
          {/* The gear's ring leaves more empty corner than the other two
              glyphs' dense silhouettes, so it reads smaller at the same
              box. One step up makes the three optically even. */}
          <Glyph
            icon={MODE_GLYPHS[mode]}
            size={mode === "settings" ? 16 : 14}
          />
          {MODE_NAMES[mode]}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

/** Persistent DOM owners the imperative panels mount into. React positions
 * these; it never renders panel content. The Composition pane has no node
 * here: the tree is React-owned and renders inside `Shell` from the bridge
 * directly. */
interface ShellHosts {
  readonly canvas: HTMLElement;
  /** The Add pane's body: shapes, text and the card library. */
  readonly add: HTMLElement;
  /** The Assets pane: every declared file, its import and placement, and the
      finder link. */
  readonly assets: HTMLElement;
  /** The Tokens pane: the theme's paints and type presets. */
  readonly tokens: HTMLElement;
  /** The Document pane: the artboard and the references it resolves. */
  readonly document: HTMLElement;
  /** Properties of the selected object. A chart's family settings and bindings
      are part of that column, not a panel of their own. */
  readonly selection: HTMLElement;
  readonly dock: HTMLElement;
}

export interface ShellLayout {
  readonly hosts: ShellHosts;
  readonly stage: HTMLElement;
  readonly dock: HTMLElement;
  /** The shell's own projection of the selection, for the panes that read it —
   *  the Tokens pane's preset list says what the canvas selection is set in
   *  rather than showing the first declared preset. */
  readonly selection: SelectionStore;
  /** The token the Tokens pane has selected for the inspector. Exclusive with
   *  the canvas selection in both directions; it lives as long as the shell. */
  readonly tokenSelection: TokenSelectionStore;
  /** The message the footer shows. `editor-main` publishes through it; the
   *  footer renders it from the same store the rest of the strip reads. */
  readonly statusMessage: StatusMessageStore;
  /** The transform readouts' state. The session publishes the readings into
   *  it through the same Fabric handlers, and the stage renders them. */
  readonly indicators: IndicatorStore;
  setBridge(
    bridge: EditorShellBridge | undefined,
    view: EditorViewControls | undefined,
  ): void;
  /** Opens the reference sheet. The session owns the `?` dispatcher and never
   *  sees React, so `editor-main` routes the gesture here. */
  showShortcuts(): void;
  /** Opens the asset finder. The chord and the menu row reach the same store
   *  the modal is bound to; a caller may name the category it opens on, which
   *  is how the font field arrives at Fonts. */
  showFinder(category?: ListingCategory): void;
  /** Opens the publish surface — the act the header's own control performs on a
   *  press. The session's `publish.surface` chord routes through here rather
   *  than through a second publish path, and it moves no host state: the switch
   *  inside the surface is the only control that does. */
  showPublishing(): void;
  /** Shows the Composition pane. The token inspector's layer links arrive here:
   *  they select the layer through the bridge and then ask to see it, which is
   *  a *show* and never a toggle — a link cannot close the pane it points at. */
  showLayers(): void;
  /** Shows the Tokens pane. A run row's "Add new token" arrives here after it
   *  creates and applies the token, so the pane that owns the token inspector
   *  is showing by the next commit. A show, never a toggle. */
  showTokens(): void;
  destroy(): void;
}

function element(datasetKey?: string): HTMLElement {
  const node = document.createElement("div");
  if (datasetKey !== undefined) node.dataset[datasetKey] = "";
  return node;
}

/** Moves a persistent host node into React-owned chrome exactly once. */
function Host({
  node,
  hidden = false,
}: {
  readonly node: HTMLElement;
  readonly hidden?: boolean;
}): React.JSX.Element {
  const slot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const parent = slot.current;
    if (parent !== null && node.parentElement !== parent) {
      parent.replaceChildren(node);
    }
  }, [node]);
  return <div ref={slot} hidden={hidden} />;
}

/** The browser's own storage, or nothing where it refuses to hand it over — a
 *  private window throws on the accessor itself. Exported because the decision
 *  is about this page and not about the shell: the draft is built over the same
 *  answer rather than asking a second time. */
export function readStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function createShellLayout(
  root: HTMLElement,
  options: {
    /** Where an accepted mode change is reported. The shell owns the switch;
     *  the boot owns what a surface reads fresh when it comes back into view —
     *  the sensor catalogue, for one, so a source added on the Host page is
     *  offered by the editor without a reload (`editor-main.ts`). */
    readonly onModeChange?: (mode: ShellMode) => void;
  } = {},
): ShellLayout {
  const storage = readStorage();
  // The preview catalogue is read once, here, beside the palette and shortcut
  // reads: the camera opens on the author's list rather than on the defaults,
  // and nothing after this re-reads storage — the settings tab writes it back.
  setActivePreviewRatios(readPreviewRatioTokens(storage));
  // The path presets are the host's list now; `loadPathPresets` in the boot
  // fills the live store before the shell renders the Add pane.
  const initial = resolveShellPalette(
    storage === undefined ? undefined : readShellChoice(storage),
    prefersDarkAppearance(),
  );
  applyShellPalette(initial);
  // The effective binding table is written once, here, before anything can
  // press a key: the dispatcher, the header toolbar, the dock's tooltips and
  // the header's publish chord all read this one table.
  const initialOverrides: ShortcutOverrides =
    storage === undefined ? {} : readShortcutOverrides(storage);
  setActiveShortcuts(resolveShortcuts(initialOverrides));

  /** The URL's request, read once at mount. The shell does not follow the
   *  address bar afterwards — a mode switch or a closed surface writes nothing
   *  back — so this is an entry and not a route. */
  const entry = parseShellEntry(window.location.search);

  const hosts: ShellHosts = {
    canvas: element(),
    add: element("yunariPanelHostAdd"),
    assets: element("yunariPanelHostAssets"),
    tokens: element("yunariPanelHostTokens"),
    document: element("yunariPanelHostDocument"),
    selection: element("yunariPanelHostSelection"),
    dock: document.createElement("div"),
  };
  hosts.canvas.id = "canvas-host";

  let view: EditorViewControls | undefined;
  let reactRoot: Root | undefined;
  const store = new SelectionStore();
  // Beside the selection it follows, and never disposed: the shell outlives
  // every document it opens.
  const tokenSelection = new TokenSelectionStore(store);
  const sheet = new SheetStore();
  // `editor-main` publishes every report the editor makes through this store;
  // the footer renders it as an ordinary React value.
  const statusMessage = new StatusMessageStore();
  // Beside the shell for the same reason the selection store is: it outlives
  // every document, and the session that fills it comes and goes.
  const indicators = new IndicatorStore();
  const publishSurface = new PublishSurfaceStore();
  const finder = new FinderStore();
  // A pane a surface inside the editor asked to see — the token inspector's
  // layer links. The slot itself stays `Shell`'s state, because the pane's
  // scroll offsets and the canvas refit belong to the gesture that moves it.
  const paneRequests = new PaneRequestStore();
  const hosting = new HostingStore();
  const getView = (): EditorViewControls | undefined => view;

  /** The inspector's fold handle. It is the column's only chrome, so it draws
   *  its own button rather than a control the panel's owner would have to
   *  provide, and its label is its tooltip — the rail's own pairing. */
  function InspectorToggle({
    collapsed,
    onToggle,
  }: {
    readonly collapsed: boolean;
    readonly onToggle: () => void;
  }): React.JSX.Element {
    const label = collapsed
      ? uiCopy.inspectorPanel.expand
      : uiCopy.inspectorPanel.collapse;
    return (
      <ControlTooltip label={label}>
        <button
          type="button"
          className="editor-shell-inspector-toggle"
          aria-label={label}
          aria-expanded={!collapsed}
          data-yunari-inspector-toggle=""
          onClick={onToggle}
        >
          <Glyph
            icon={collapsed ? INSPECTOR_EXPAND_GLYPH : INSPECTOR_COLLAPSE_GLYPH}
            size={14}
          />
        </button>
      </ControlTooltip>
    );
  }

  function Shell({ mode, onModeChange }: ShellLayoutProps): React.JSX.Element {
    // The installed units arrive after boot, so the Add pane's count is read
    // from the live store rather than from a build-time library.
    const widgetUnits = useSyncExternalStore(
      subscribeWidgetUnits,
      activeWidgetUnits,
    );
    const [palette, setPalette] = useState(initial);
    /** Whether the OS is still choosing. Initialized from storage — the same
     *  question `createShellLayout` asked for `initial` — and moved from there
     *  by the Appearance tab, which owns the choice and writes both this and
     *  storage in one step. */
    const [following, setFollowing] = useState(
      storage === undefined || readShellChoice(storage) === undefined,
    );
    const [slot, setSlot] = useState<RailSlot>("composition");
    const [collapsed, setCollapsed] = useState(false);
    /** Whether the right column is folded away. The selection no longer decides
     *  it: the column is the author's, and a panel that vanished because nothing
     *  was selected could not be left open while they worked on the canvas. */
    const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
    /** The Settings page the surface shows. Local state, like the palette
     *  above: it is shell chrome, not document state, and it is never
     *  serialized. The gear keeps the last page; a surface that asks for one
     *  (the finder's needs-key path) sets it before switching. */
    const [settingsPage, setSettingsPage] = useState<SettingsPage>("displays");
    /** The store's half is a mode-level choice now that its control is in the
     *  header, so it lives beside the mode rather than inside the region. */
    const [storeTab, setStoreTab] = useState<StoreTab>("local");
    /** The author's bindings, held here because the effective table lives
     *  outside React. Initialized from storage — the same read
     *  `createShellLayout` made for the live table — and moved from there by
     *  the Keyboard tab, which asks for a new set and writes storage itself. */
    const [overrides, setOverrides] = useState(initialOverrides);
    /** **The Host mode's status line, as its region publishes it.** The strip
     *  is the shell's in every mode, so the content is the region's and the
     *  placement is this strip's — the shell draws these two strings rather than
     *  reading the host a second time. `undefined` until the region answers, and
     *  nothing is drawn for it: a count no read answered is not a zero. The
     *  region withdraws the line when it unmounts, so this state is one visit's
     *  and never outlives it — otherwise the next visit's strip would mount
     *  holding the last visit's sentence. */
    const [hostStatus, setHostStatus] = useState<
      SettingsStatusLine | undefined
    >(undefined);
    /** The Themes mode's own reading, published by its region for the same
     *  reason and through the same shape as the host's: the region owns what
     *  the strip says, the shell owns where it goes. */
    const [storeStatus, setStoreStatus] = useState<number | undefined>(
      undefined,
    );
    const applyOverrides = (next: ShortcutOverrides): void => {
      setOverrides(next);
      setActiveShortcuts(resolveShortcuts(next));
    };
    /** The document's name and the release version both come through the
     *  shell's one reading of `ThemeMetadata` — the bridge snapshot — so the
     *  About tab's version is the same fact the Document pane's
     *  `releaseVersion` row reads, never a second source. */
    const selection = useSelection(store);
    const { releaseVersion, objectCount, assetCount } = selection;
    const sheetOpen = useSheet(sheet);
    const finderState = useFinder(finder);
    const finderOpen = finderState.open;
    const fontActions = store.bridge?.session.fontActions?.();
    const wallpaperActions = store.bridge?.session.wallpaperActions?.();
    /** Re-frame on the panel toggle, once the viewport has the new width.
     *
     * A resize does not need this any more: the viewport derives whether the
     * camera was fitted and re-fits that one itself. What it deliberately will
     * not do is touch a camera the author has zoomed or panned, and collapsing a
     * panel is not a window nudge — the author handed the canvas 288px on
     * purpose — so this is the one case where their view still follows. Still
     * waiting on the change event rather than a frame: the aside re-renders
     * after the frame, so a fit measured then reads the old box and lands on the
     * collapsed zoom on the way back in.
     */
    const refitOnViewportChange = (): void => {
      const viewport = store.bridge?.editor.viewport;
      if (viewport === undefined) return;
      const off = viewport.onChange(() => {
        off();
        viewport.zoomToFit();
      });
    };

    /** The inspector folds toward the right edge, so the same width the pane
     *  hands the canvas comes back. The refit is the pane's rule: a column
     *  changing width is the author handing the stage pixels on purpose, not a
     *  window nudge the camera should ignore. */
    const toggleInspector = (): void => {
      setInspectorCollapsed((current) => !current);
      refitOnViewportChange();
    };

    /** A newly selected object reopens the inspector.
     *
     * Folding is the author's while the selection stands, but a column folded
     * and then forgotten has no route back from the canvas — the selection is
     * what should lead them to it. The snapshot carries no object id, so the
     * change is read from the selected rows of the layer tree, the same
     * projection the composition pane draws. Comparing the joined ids keeps an
     * unrelated layer update from undoing a fold. */
    const shownSelection = useRef("");
    useEffect(() => {
      const next = (store.bridge?.layers() ?? [])
        .filter((row) => row.selected)
        .map((row) => row.id)
        .join("\n");
      if (next === shownSelection.current) return;
      shownSelection.current = next;
      if (next !== "") setInspectorCollapsed(false);
    }, [selection]);

    /** Each pane's scroll offset, kept across the swap.
     *
     * The rail is single-pane, so opening Add really does tear the composition
     * list down and build it again — the selection, the inspector's geometry
     * and the canvas handles all survive, and only the scroll was lost. With
     * the Starter's 52 rows and more in a theme an author has built, finding
     * your place again after a glance at the assets is the whole cost of it. */
    const scrollOf = useRef(new Map<RailSlot, number>());
    /** The box that scrolls, which is the showing pane's **body** and not the
     *  column around it (the overflow rule): the column clips, so its own
     *  `scrollTop` is always 0 and the offset has to come off the body inside
     *  it. Only the showing pane's body carries this — the other four are
     *  `hidden`, so their bodies are not scrollable boxes at all. */
    const paneBody = useRef<HTMLDivElement | null>(null);

    /** The OS gets a vote only while the author has not cast one.
     *
     *  `following` is the same condition `readShellChoice` answers, held as the
     *  state the Appearance tab's toggle is: it is written where the choice is,
     *  so the two cannot disagree, and it holds when the browser refused its
     *  storage — where a storage read would call every session choice "no
     *  choice" and let the OS overrule it. The subscription is armed only while
     *  following, so a palette change re-renders nothing here. */
    useEffect(() => {
      if (!following) return;
      return watchSystemAppearance((prefersDark) => {
        const next = systemShellPalette(prefersDark);
        applyShellPalette(next);
        setPalette(next);
      });
    }, [following]);

    /** Opens `id` without the toggle below, for a caller that meant "show me
     *  this": the rail's own press is what decides a close, and a link that
     *  selects a layer must never close the pane the layer lives in. */
    const openSlot = (id: RailSlot): void => {
      setSlot(id);
      setCollapsed(false);
      const restore = scrollOf.current.get(id) ?? 0;
      // After the pane's own content is laid out, or the offset lands on
      // whatever height it has at that moment.
      requestAnimationFrame(() => {
        if (paneBody.current !== null) paneBody.current.scrollTop = restore;
        // Only when the panel is coming back. A swap between two open panes
        // changes which pane shows, not how wide the panel is, so nothing
        // resizes and no change event ever arrives — the listener would sit
        // armed until the author's next pan or zoom, and that gesture is the one
        // it ate, snapping the view back to fit.
        if (collapsed) refitOnViewportChange();
      });
    };
    /** The slot already showing closes the pane; any other slot — and the
     *  closed one itself — shows it. The canvas is what an author works in, so
     *  the chrome around it is allowed to get out of the way. */
    const choosePane = (id: RailSlot): void => {
      // Read the offset off the DOM rather than off an event: the panel is torn
      // down by the swap, so anything held in state is already gone by the time
      // this runs for the next slot. Taken before any branch, because every
      // branch but the collapse hides the panel and a `display: none` box has
      // no scroll offset to read — the getter answers 0, so a save taken after
      // the collapse writes the author's place back as the top of the list.
      if (!collapsed && paneBody.current !== null) {
        scrollOf.current.set(slot, paneBody.current.scrollTop);
      }
      if (!collapsed && slot === id) {
        setCollapsed(true);
        // Collapsing hands the canvas 288px, and the refit runs here too rather
        // than only on a pane swap.
        refitOnViewportChange();
        return;
      }
      openSlot(id);
    };
    /** A pane another surface asked to see: the token inspector's layer links
     *  are the one caller. The offset is saved first, as the rail's press does,
     *  so swapping away from an open pane keeps its place; the nonce is what
     *  says the request is new, because the same slot may be asked for twice. */
    const handledPaneRequest = useRef(0);
    const paneRequest = usePaneRequest(paneRequests);
    useEffect(() => {
      if (
        paneRequest === undefined ||
        handledPaneRequest.current === paneRequest.nonce
      ) {
        return;
      }
      handledPaneRequest.current = paneRequest.nonce;
      if (!collapsed && paneBody.current !== null) {
        scrollOf.current.set(slot, paneBody.current.scrollTop);
      }
      if (!collapsed && slot === paneRequest.slot) return;
      openSlot(paneRequest.slot);
    }, [paneRequest]);

    return (
      <div className="editor-shell">
        {/* A full-width strip, not a floating card: the header is the window's
            top edge, and the header rule gives it document- and editor-level actions only.
            The brand, the two menus and the theme toolbar sit left; the publish
            control is the editor's one filled accent button, on the right. No
            tagline and no document readout — a per-document fact belongs on the
            canvas, and the readout only grew with the LAN. The shell palette is not
            here either: the shell layout makes it a set-once choice and it lives in
            Settings, at the accepted cost of no at-a-glance readout. */}
        <header className="editor-shell-header">
          <strong>{uiCopy.brand}</strong>
          {/* The mode switch, in the header rather than in a strip under it:
              the rail rule forbids a second horizontal bar, and two stacked rows of
              navigation make the first read as chrome rather than a choice. */}
          <ModeSwitch mode={mode} onModeChange={onModeChange} />
          {mode === "themes" && (
            <StoreHalves tab={storeTab} onTab={setStoreTab} />
          )}
          {/* the header rule: the right-hand region is **per-mode**. The menus and the
              publish chord are the editor's own actions — they act on the open
              document, and neither of the other two modes has one — so a mode
              that has brought no actions of its own shows the switch and
              nothing beside it, rather than the editor's controls over a
              surface that cannot answer them. */}
          {mode === "editor" && (
            <>
              <ShellMenuBar
                store={store}
                getView={getView}
                onFindAssets={() => finder.set(true)}
              />
              <PublishControl
                hosting={hosting}
                surface={publishSurface}
                session={store.bridge?.session}
              />
            </>
          )}
        </header>
        {/* The editor's body is **hidden, never unmounted**, while another mode
            shows. The canvas host lives inside it, so taking it off the tree
            would destroy the open document on the way to the store — which is
            the invariant a mode switch has to keep, and the reason the switch
            asks before it leaves a dirty one. */}
        <div
          className="editor-shell-body"
          data-collapsed={collapsed}
          data-inspector={inspectorCollapsed ? "collapsed" : undefined}
          hidden={mode !== "editor"}
          // The document stays mounted here while another mode shows. The
          // marker is the shortcut manager's signal that the body a product
          // chord would edit is not the one on screen.
          data-yunari-editor-inactive={mode === "editor" ? undefined : ""}
        >
          {/* The rail is the left edge's own column, ahead of the pane's, so
              the canvas gets the pane's width back and the slots read as one
              vertical choice rather than a second navigation bar. */}
          <Rail
            slot={slot}
            collapsed={collapsed}
            onChoose={choosePane}
            onOpenSettings={() => onModeChange("settings")}
          />
          <aside className="editor-shell-panel editor-glass" hidden={collapsed}>
            {/* Every pane wears the same chrome — a title bar, a body and a
                footer toolbar — and each is `hidden` rather than unmounted,
                because the persistent hosts below live inside them and React
                re-parents those nodes; a pane taken off the tree would take its
                host's content with it. The pane is the one owner of the
                `data-yunari-panel` name, so the Composition pane's is
                `layers` — the name the specs and the panel CSS already browse
                by — and the other four are named for their rail slot. The
                visible title is the slot's own word, as the other four are;
                the `layers` name is only the DOM handle.

                **Each title bar carries its own list's count, and the
                list is named at the mount rather than in the pane.** Four of
                the five panes are imperative hosts, so no React component
                inside one owns its list and the count has to be sourced here.
                The source of each:
                - Composition — the scene's objects, through the bridge's own
                  `objectCount`, which the strip reads too. One number, two
                  chrome surfaces, and deliberately not a second spelling of it.
                - Add — the installed widget units, `activeWidgetUnits()`, not
                  `insertGroups()`'s objects: the pane's insert grid adds
                  primitives and a text object to the units, and the Add pane's
                  title bar counts the units.
                - Tokens — nothing, because its body is two libraries with
                  their own headings; each heading carries its own count
                  beside it rather than one total over both.
                - Document — nothing. Its body is two sections of fields and it
                  holds no list of its own, so it draws no count rather than a
                  fabricated `0` (the same rule the two counts above take before
                  a bridge is set).
                - Assets — the asset manager's declarations, through
                  `assetCount`, which the session reports because the manager is
                  the session's and the shell never holds it.

                A count is `undefined` where the list has not loaded, and `Pane`
                then draws no count span at all. */}
            <Pane
              id="layers"
              title={uiCopy.rail.slots.composition}
              icon={RAIL_GLYPHS.composition}
              count={
                objectCount === undefined
                  ? undefined
                  : uiCopy.statusBar.objects(objectCount)
              }
              hidden={slot !== "composition"}
              bodyRef={paneBody}
              footer={<LayerActions bridge={store.bridge} />}
            >
              <CompositionPane bridge={store.bridge} />
            </Pane>
            {/* The Add pane's body is one host and one React tree: shapes,
                text and the card library. Local files belong to the Assets slot.
                */}
            <Pane
              id="add"
              title={uiCopy.rail.slots.add}
              icon={RAIL_GLYPHS.add}
              count={uiCopy.paneCounts.units(widgetUnits.length)}
              hidden={slot !== "add"}
              bodyRef={paneBody}
            >
              <Host node={hosts.add} hidden={slot !== "add"} />
            </Pane>
            {/* The declared files' own pane. Its body is the persistent host
                the session's asset library mounts into. */}
            <Pane
              id="assets"
              title={uiCopy.rail.slots.assets}
              icon={RAIL_GLYPHS.assets}
              count={
                assetCount === undefined
                  ? undefined
                  : uiCopy.paneCounts.files(assetCount)
              }
              hidden={slot !== "assets"}
              bodyRef={paneBody}
            >
              <Host node={hosts.assets} hidden={slot !== "assets"} />
            </Pane>
            <Pane
              id="tokens"
              title={uiCopy.rail.slots.tokens}
              icon={RAIL_GLYPHS.tokens}
              hidden={slot !== "tokens"}
              bodyRef={paneBody}
            >
              <Host node={hosts.tokens} hidden={slot !== "tokens"} />
            </Pane>
            <Pane
              id="document"
              title={uiCopy.rail.slots.document}
              icon={RAIL_GLYPHS.document}
              hidden={slot !== "document"}
              bodyRef={paneBody}
            >
              <Host node={hosts.document} hidden={slot !== "document"} />
            </Pane>
          </aside>
          <main
            id="stage"
            className="editor-shell-stage"
            aria-label={uiCopy.stage.label}
          >
            <Host node={hosts.canvas} />
            {/* The rotate and scale readings. The session's Fabric handlers
                publish them; this layer draws them beside the pointer, and it
                never intercepts one. */}
            <IndicatorOverlay store={indicators} />
            {/* The two top corners in one row, which is what keeps the overflow rule's
                "clusters cannot collide" true without either knowing the
                other's width. The row is `pointer-events: none`; the two
                clusters take it back, so the band between them is still the
                canvas's. */}
            <div className="editor-shell-stage-top">
              {/* What the author is editing, in the corner the stage rule gives identity.
                  It reads the store rather than a prop, so a bridge set after
                  the shell mounted — and a rename after that — reaches it too. */}
              <DocumentIdentity store={store} />
              {/* The store, not a local: a late-set bridge must reach the
                  readout the same way it reaches the inspector and menus. */}
              {store.bridge === undefined ? null : (
                <DisplaySwitch
                  viewport={store.bridge.editor.viewport}
                  playback={<BackgroundPlayback store={store} />}
                />
              )}
            </div>
            {/* The dock owns its own element and derives its own visibility;
                this is only the slot that puts its mount point in the stage. */}
            <Host node={hosts.dock} />
            {/* Renders no DOM of its own: it only binds the canvas's own
                `contextmenu` listener, so it sits with the stage it listens to. */}
            <CanvasContextMenu bridge={store.bridge} />
            {/* The reference, driven by the session's `?` dispatcher through
                this external store. Rendering it in the shell rather than a
                local `useEffect` listener keeps the manager the sole
                window-level dispatcher. */}
            <ShortcutReference
              open={sheetOpen}
              onOpenChange={(next) => sheet.set(next)}
            />
            {/* The one place the finder is mounted. Its chord and its two menu
                entries all move this one store, the same way `?` moves the
                sheet's. */}
            <AssetFinder
              open={finderOpen}
              onOpenChange={(next) => finder.set(next)}
              {...(fontActions === undefined ? {} : { font: fontActions })}
              {...(wallpaperActions === undefined
                ? {}
                : { wallpaper: wallpaperActions })}
              {...(finderState.category === undefined
                ? {}
                : { initialCategory: finderState.category })}
              onAction={async (page, result, placement) => {
                const session = store.bridge?.session;
                if (session?.importAsset === undefined)
                  return {
                    ok: false,
                    message: uiCopy.assets.hostUnavailable,
                  };
                return session.importAsset(page, result, placement);
              }}
              onOpenConnections={() => {
                finder.set(false);
                setSettingsPage("asset-sources");
                onModeChange("settings");
              }}
            />
          </main>
          <aside
            className="editor-shell-inspector editor-glass"
            data-collapsed={inspectorCollapsed ? "true" : undefined}
          >
            <InspectorToggle
              collapsed={inspectorCollapsed}
              onToggle={toggleInspector}
            />
            {/* One panel, so no tab strip: a strip with one tab is a control
                that cannot choose. The theme's own settings used to sit under
                this panel behind a `keepMounted` Design tab, which existed so
                a selection could not hide them; they are in the left column's
                Document pane now, which no selection can hide either, so the
                property is discharged by the move rather than by an attribute.
                A chart's own fields are still in this column — its owner is
                asked for them — so a chart keeps every question it has.

                The column stays mounted while folded, so its own fields keep
                their draft and the fold is a width, not a teardown. */}
            <Host node={hosts.selection} />
          </aside>
        </div>
        {/* The mode's own region — the seam a non-editor surface fills. A task
            that lands one replaces this element's body and nothing around it:
            the switch, the header, the status bar and the editor's own body are
            the shell's, and a region is what a mode adds. Each region is handed
            the mode rather than the shell choosing between them, so the two
            below mount together and one of them draws — and a mode with no
            surface yet renders an empty section rather than a placeholder
            standing in for one. */}
        {mode === "editor" ? null : (
          <section className="editor-shell-mode" data-yunari-mode-region={mode}>
            {/* **The session is read at the moment the action fires, not at
                this render**: the region is mounted for the whole life of the
                shell and a later document mount replaces the bridge, so a
                callback holding this render's session would open a theme into
                the document the shell had a moment ago.

                **The editor first, then the document** (A.7d): a body that is
                `hidden` measures zero, so the mount behind it fits nothing —
                and a cancelled open leaves the author in the store. */}
            <StoreModeRegion
              mode={mode}
              tab={storeTab}
              onTab={setStoreTab}
              onStatus={setStoreStatus}
              onOpenTheme={(id) => {
                void store.bridge?.session.openLibraryTheme(id, () =>
                  onModeChange("editor"),
                );
              }}
              onThemeDeleted={(id) => store.bridge?.session.themeRemoved(id)}
              onThemePublished={(id) =>
                store.bridge?.session.themePublished(id)
              }
            />
            {/* The Host mode's region, beside the store's rather than chosen
                between here: each is handed the mode and draws itself in its
                own, so the section holds one surface whatever mode is showing.
                It takes no route from the shell — it writes the Host's own
                settings, and assigning a theme is the store's. */}
            <SettingsRegion
              mode={mode}
              page={settingsPage}
              onPageChange={setSettingsPage}
              onStatus={setHostStatus}
              storage={storage}
              palette={palette}
              following={following}
              onPalette={setPalette}
              onFollowing={setFollowing}
              overrides={overrides}
              onOverrides={applyOverrides}
              releaseVersion={releaseVersion}
            />
          </section>
        )}
        {/* The strip: readouts only, the counts on the left and the save
            state and live mark on the right. Each mode draws its own facts:
            the editor's counts and its document state, the store's listing
            count, the host's two strings. A mode that has not published its
            reading draws nothing rather than another mode's numbers. */}
        <footer id="status" className="editor-shell-status">
          {mode === "settings" ? (
            <>
              <span data-yunari-host-display-count="">
                {hostStatus?.displays ?? null}
              </span>
              <p
                className="editor-shell-status-host"
                role="status"
                data-yunari-host-status=""
              >
                {hostStatus?.status ?? null}
              </p>
            </>
          ) : mode === "themes" ? (
            storeStatus === undefined ? null : (
              <span role="status" data-yunari-store-count="">
                {uiCopy.statusBar.themes(storeStatus)}
              </span>
            )
          ) : (
            <>
              <StatusReadout store={store} />
              <StatusMessage store={statusMessage} />
              <DiagnosticMessage canvas={store.bridge?.editor.canvas} />
              <SaveState session={store.bridge?.session} />
              {/* The host's own fact, beside the save state: an unknown host
                  renders no mark rather than "not live". */}
              <PublishIndicator store={hosting} />
            </>
          )}
        </footer>
      </div>
    );
  }

  /**
   * The mode, and the one guard in front of it.
   *
   * The shell opens on the editor — the document is what an author came for —
   * and the mode is never persisted: it is chrome, not authored state.
   *
   * **The guard fires on the way to Themes, and nowhere else.** The editor and
   * Settings share the editing workspace: Settings is chrome over the document,
   * the body stays mounted behind `hidden`, and nothing can be lost by moving
   * between them. Themes is the surface that puts the document away, so it is
   * the transition the prompt protects — from either of the other two modes.
   * That keeps the gear usable mid-edit, as the modal it replaces was.
   *
   * It is the editor's **existing** replacement prompt with the switch's own
   * question, not a second guard: the prompt's copy is the only thing that makes
   * it read as a document replacement, so one instrument answers both, and it is
   * the one instrument that can offer **Save**. A `cancel` returns before the
   * mode moves; a `save` waits for the save to finish, so a failed one leaves the
   * author in the editor rather than past a guard that did not complete.
   *
   * **A failed save is read off the document, not off a return value.**
   * `saveLibrary()` resolves whether or not the save landed — the editor reports
   * its own failures — so the dirty mark is asked again after it. Still dirty
   * means the save did not happen, and the author stays where their work is.
   *
   * **Save means the library, not the package.** Leaving the editor is the same
   * act as Ctrl+S, so the answer saves where the product stores a theme; a
   * package download here would send the author to their Downloads folder for
   * work that was only meant to be kept.
   *
   * The question and the save are a promise the switch cannot hand back: its
   * handler returns `void`, so the promise is settled where it is created rather
   * than left floating for the runtime to report.
   */
  function ShellRoot(): React.JSX.Element {
    const [mode, setMode] = useState<ShellMode>(entry.mode);
    // The URL's publish request, applied once after the header has mounted.
    // `publishSurface` is the store the header control and the chord already
    // drive, so this opens that one surface rather than a second publish path;
    // the effect is a mount one, so closing the surface does not reopen it.
    useEffect(() => {
      if (entry.publish) publishSurface.set(true);
    }, []);
    const requestMode = (next: ShellMode): void => {
      if (next === mode) return;
      // A mode switch hides the editor's body, never unmounts it, so it moves
      // no document and can lose no unsaved work. The replacement prompt
      // belongs to New/Open, which do replace the document.
      setMode(next);
      options.onModeChange?.(next);
    };
    return <Shell mode={mode} onModeChange={requestMode} />;
  }

  flushSync(() => {
    reactRoot = createRoot(root);
    reactRoot.render(<ShellRoot />);
  });

  const stage = root.querySelector<HTMLElement>("#stage");
  if (stage === null) {
    throw new Error("Editor shell did not mount required hosts.");
  }

  // The dock is a separate React root so canvas remounts never disturb it. It
  // owns its own element now and derives `data-visible` from the bridge it is
  // given, so nothing outside it writes that attribute; the render is flushed
  // so the element exists before the caller reads `dock`.
  const dockRoot = createRoot(hosts.dock);
  flushSync(() => {
    dockRoot.render(<CanvasDock bridge={undefined} />);
  });
  const dock = root.querySelector<HTMLElement>(".editor-shell-dock");
  if (dock === null) {
    throw new Error("Editor shell did not mount the canvas toolbar.");
  }

  return {
    hosts,
    stage,
    dock,
    selection: store,
    tokenSelection,
    statusMessage,
    indicators,
    setBridge(nextBridge, nextView) {
      // The store notifies subscribers, so React re-renders the inspector and
      // menus without a manual root re-render — and it keeps working when the
      // bridge is replaced by a later document mount.
      view = nextView;
      store.set(nextBridge);
      flushSync(() => {
        dockRoot.render(<CanvasDock bridge={nextBridge} />);
      });
    },
    showShortcuts() {
      // The gesture arrives from outside React, so the store writes and the
      // subscription re-renders; `flushSync` settles it before this returns.
      flushSync(() => sheet.set(true));
    },
    showFinder(category) {
      flushSync(() => finder.set(true, category));
    },
    showPublishing() {
      // The gesture arrives from outside React and lands on the popover's own
      // open flag, exactly as a press on the header control does: the chord
      // reveals the surface and touches nothing the host is doing.
      flushSync(() => publishSurface.set(true));
    },
    showLayers() {
      // No `flushSync`, unlike the two above: this one is called from a pane's
      // own React event, so the request belongs to that render's batch. The
      // shell's effect applies it and the pane is showing by the next commit.
      paneRequests.show("composition");
    },
    showTokens() {
      // The same request shape as `showLayers`: the run row is React's, so the
      // shell's effect applies the request without a synchronous flush.
      paneRequests.show("tokens");
    },
    destroy() {
      store.bridge?.destroy();
      store.set(undefined);
      dockRoot.unmount();
      reactRoot?.unmount();
      reactRoot = undefined;
    },
  };
}
