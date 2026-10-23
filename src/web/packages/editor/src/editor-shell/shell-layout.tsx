import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import type { ListingCategory } from "@yunari/renderer-core";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { AssetFinder } from "../asset-finder/modal.js";
import { CARD_LIBRARY } from "../card-library.js";
import { hitTargetClasses } from "../components/ui/control-well.js";
import {
  HostSettingsRegion,
  type HostStatusLine,
} from "../host-settings-mode/region.js";
import { CompositionPane } from "../panes/composition/composition-pane.js";
import { confirmDocumentReplacement } from "../persistence-manager/index.js";
import type { PublishSwitch } from "../publish-client.js";
import {
  readShortcutOverrides,
  resolveShortcuts,
  type ShortcutOverrides,
  setActiveShortcuts,
} from "../shortcut-manager/bindings.js";
import { StoreModeRegion } from "../store-mode/region.js";
import { uiCopy } from "../ui-copy.js";
import type { EditorShellBridge } from "./bridge.js";
import { CanvasContextMenu } from "./canvas-context-menu.js";
import { CanvasDock } from "./canvas-dock.js";
import { DiagnosticMessage } from "./diagnostic-message.js";
import { DisplaySwitch } from "./display-switch.js";
import { DocumentIdentity } from "./document-identity.js";
import { HostingStore } from "./hosting-store.js";
import { RAIL_GLYPHS } from "./icons.js";
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
import { Settings, type SettingsTab } from "./settings.js";
import { ShellMenuBar } from "./shell-menu-bar.js";
import {
  FinderStore,
  PublishSurfaceStore,
  SelectionStore,
  SheetStore,
  useFinder,
  useSelection,
  useSheet,
} from "./shell-stores.js";
import { ShortcutReference } from "./shortcut-reference.js";
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
export type ShellMode = "editor" | "themes" | "this-pc";

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
  "this-pc": uiCopy.modes.thisPc,
};

/** The order the header draws them in, which is a separate decision from what
 *  each is called. */
const MODE_ORDER = [
  "editor",
  "themes",
  "this-pc",
] as const satisfies readonly ShellMode[];

/** The switch's id, and the stem of each segment's. §5 rule 5 wants every
 *  control to carry an id; the segment's is derived from the mode the way
 *  `useControlIds` derives one from the control it names. */
const MODE_SWITCH_ID = "yunari-shell-modes";

const modeSegmentId = (mode: ShellMode): string => `${MODE_SWITCH_ID}-${mode}`;

/**
 * DESIGN.md §5's Segmented, in the header's **bare** form (see 0074).
 *
 * The one Segmented component (`components/ui/control-segmented.tsx`) is a
 * labelled *row* — §5's 74px label column beside a value cell — and the header
 * drawing (`docs/design/mockups/current/shell.html`) draws this one as a well
 * with the three names in it and no label at all, so the group is its own
 * label and the primitive is composed here rather than the row vocabulary
 * growing a fourth shape for one caller.
 *
 * The chosen item is lifted to `--stage` with `--text` — the shared chosen
 * treatment, never an accent fill: §4 allows one accent-filled element per
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
  /** The Add pane's body: the insert list and, at its foot, the declared-asset
      library (`§5.2` absorbs the Assets pane into Add). */
  readonly add: HTMLElement;
  /** The Tokens pane: the theme's paints and type presets. */
  readonly tokens: HTMLElement;
  /** The Document pane: the artboard and the references it resolves. */
  readonly document: HTMLElement;
  /** Properties of the selected object. A chart's family settings and bindings
      are part of that column, not a panel of their own. */
  readonly selection: HTMLElement;
  readonly status: HTMLElement;
  readonly dock: HTMLElement;
}

export interface ShellLayout {
  readonly hosts: ShellHosts;
  readonly stage: HTMLElement;
  readonly dock: HTMLElement;
  /** The shell's own projection of the selection, for the panes that read it —
   *  the Tokens pane's preset chooser opens on the preset the selection is set
   *  in rather than on the first declared one (`vg-094`). */
  readonly selection: SelectionStore;
  setBridge(
    bridge: EditorShellBridge | undefined,
    view: EditorViewControls | undefined,
    /** What the publish surface's switch drives. Owned by `editor-main`, so the
     *  surface decides whether publishing is on and never holds a document. */
    publish?: PublishSwitch,
  ): void;
  /** Opens §7's reference sheet. The session owns the `?` dispatcher and never
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

export function createShellLayout(root: HTMLElement): ShellLayout {
  const storage = readStorage();
  const initial = resolveShellPalette(
    storage === undefined ? undefined : readShellChoice(storage),
    prefersDarkAppearance(),
  );
  applyShellPalette(initial);
  // The effective binding table is written once, here, before anything can
  // press a key: the dispatcher, the menubar, the dock's tooltips and the
  // header's publish chord all read this one table.
  const initialOverrides: ShortcutOverrides =
    storage === undefined ? {} : readShortcutOverrides(storage);
  setActiveShortcuts(resolveShortcuts(initialOverrides));

  const hosts: ShellHosts = {
    canvas: element(),
    add: element("yunariPanelHostAdd"),
    tokens: element("yunariPanelHostTokens"),
    document: element("yunariPanelHostDocument"),
    selection: element("yunariPanelHostSelection"),
    status: document.createElement("span"),
    dock: document.createElement("div"),
  };
  hosts.canvas.id = "canvas-host";
  // The status line's address. `editor-main` writes every report the editor
  // makes into this span, and the footer around it now also carries the counts,
  // the diagnostic, the save state and the live mark — so a reader that means
  // the message has to name the message rather than the footer.
  hosts.status.id = "status-message";

  let view: EditorViewControls | undefined;
  let publish: PublishSwitch | undefined;
  let reactRoot: Root | undefined;
  const store = new SelectionStore();
  const sheet = new SheetStore();
  const publishSurface = new PublishSurfaceStore();
  const finder = new FinderStore();
  const hosting = new HostingStore();
  const getView = (): EditorViewControls | undefined => view;

  function Shell({ mode, onModeChange }: ShellLayoutProps): React.JSX.Element {
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
    /** §7's settings modal, opened by the rail's gear. Local state, like the
     *  palette above: it is a shell surface, not document state, and it is
     *  never serialized. */
    const [settingsOpen, setSettingsOpen] = useState(false);
    /** The tab a surface asked Settings to open on, cleared when it closes so
     *  the next open is the author's own last choice. */
    const [settingsTab, setSettingsTab] = useState<SettingsTab | undefined>(
      undefined,
    );
    /** The author's bindings, held here because the effective table lives
     *  outside React. Initialized from storage — the same read
     *  `createShellLayout` made for the live table — and moved from there by
     *  the Keyboard tab, which asks for a new set and writes storage itself. */
    const [overrides, setOverrides] = useState(initialOverrides);
    /** **The Host mode's status line, as its region publishes it.** §7.6's strip
     *  is the shell's in every mode, so the content is the region's and the
     *  placement is this strip's — the shell draws these two strings rather than
     *  reading the host a second time. `undefined` until the region answers, and
     *  nothing is drawn for it: a count no read answered is not a zero. The
     *  region withdraws the line when it unmounts, so this state is one visit's
     *  and never outlives it — otherwise the next visit's strip would mount
     *  holding the last visit's sentence. */
    const [hostStatus, setHostStatus] = useState<HostStatusLine | undefined>(
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
    const {
      activeKind: kind,
      releaseVersion,
      objectCount,
      tokenCount,
    } = useSelection(store);
    const sheetOpen = useSheet(sheet);
    const finderState = useFinder(finder);
    const finderOpen = finderState.open;
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

    /** Each pane's scroll offset, kept across the swap.
     *
     * The rail is single-pane, so opening Add really does tear the composition
     * list down and build it again — the selection, the inspector's geometry
     * and the canvas handles all survive, and only the scroll was lost. With
     * the Starter's 52 rows and more in a theme an author has built, finding
     * your place again after a glance at the assets is the whole cost of it. */
    const scrollOf = useRef(new Map<RailSlot, number>());
    /** The box that scrolls, which is the showing pane's **body** and not the
     *  column around it (§7.7, `vg-208`): the column clips, so its own
     *  `scrollTop` is always 0 and the offset has to come off the body inside
     *  it. Only the showing pane's body carries this — the other three are
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

    return (
      <div className="editor-shell">
        {/* A full-width strip, not a floating card: the header is the window's
            top edge, and §7.1 gives it document- and editor-level actions only.
            The brand and the three menus sit left; the publish control is the
            editor's one filled accent button, on the right. No tagline and no
            document readout — a per-document fact belongs on the canvas (§7.5),
            and the readout only grew with the LAN. The shell palette is not
            here either: §7 makes it a set-once choice and it lives in
            Settings, at the accepted cost of no at-a-glance readout. */}
        <header className="editor-shell-header">
          <strong>{uiCopy.brand}</strong>
          {/* §7.1's mode switch, in the header rather than in a strip under it:
              §7.2 forbids a second horizontal bar, and two stacked rows of
              navigation make the first read as chrome rather than a choice. */}
          <ModeSwitch mode={mode} onModeChange={onModeChange} />
          {/* §7.1: the right-hand region is **per-mode**. The menus and the
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
                session={store.bridge?.session}
                publish={publish}
                hosting={hosting}
                surface={publishSurface}
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
          hidden={mode !== "editor"}
        >
          {/* The rail is the left edge's own column, ahead of the pane's, so
              the canvas gets the pane's width back and the slots read as one
              vertical choice rather than a second navigation bar. */}
          <Rail
            slot={slot}
            collapsed={collapsed}
            onChoose={choosePane}
            onOpenSettings={() => {
              setSettingsTab(undefined);
              setSettingsOpen(true);
            }}
          />
          <aside className="editor-shell-panel editor-glass" hidden={collapsed}>
            {/* Every pane wears the same chrome — a title bar, a body and a
                footer toolbar — and each is `hidden` rather than unmounted,
                because the persistent hosts below live inside them and React
                re-parents those nodes; a pane taken off the tree would take its
                host's content with it. The pane is the one owner of the
                `data-yunari-panel` name, so the Composition pane's is
                `layers` — the name the specs and the panel CSS already browse
                by — and the other three are named for their rail slot. The
                visible title is the slot's own word, as the other three are;
                the `layers` name is only the DOM handle.

                **Each title bar carries its own list's count (§7.3), and the
                list is named at the mount rather than in the pane.** Three of
                the four panes are imperative hosts, so no React component
                inside one owns its list and the count has to be sourced here.
                The source of each:
                - Composition — the scene's objects, through the bridge's own
                  `objectCount`, which §7.6's strip reads too. One number, two
                  chrome surfaces, and deliberately not a second spelling of it.
                - Add — the card library's entry count, `CARD_LIBRARY`, not
                  `insertGroups()`'s objects: the pane's insert grid adds
                  primitives and a text object to the library, and the drawing's
                  title bar counts the library.
                - Tokens — the theme's paints, through the bridge's
                  `tokenCount`, whose membership rule `PaintList` shares.
                - Document — nothing. Its body is two sections of fields and it
                  holds no list of its own, so it draws no count rather than a
                  fabricated `0` (the same rule the two counts above take before
                  a bridge is set).

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
            {/* The Add pane's body — the insert list and, at its foot, the
                declared-asset library — is one host and one React tree. `§5.2`
                puts the file path in Add, and a fourth slot for it would be a
                slot DESIGN.md does not name. */}
            <Pane
              id="add"
              title={uiCopy.rail.slots.add}
              icon={RAIL_GLYPHS.add}
              count={uiCopy.paneCounts.units(CARD_LIBRARY.length)}
              hidden={slot !== "add"}
              bodyRef={paneBody}
            >
              <Host node={hosts.add} hidden={slot !== "add"} />
            </Pane>
            <Pane
              id="tokens"
              title={uiCopy.rail.slots.tokens}
              icon={RAIL_GLYPHS.tokens}
              count={
                tokenCount === undefined
                  ? undefined
                  : uiCopy.paneCounts.tokens(tokenCount)
              }
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
            {/* §7.5's two top corners in one row, which is what keeps §7.7's
                "clusters cannot collide" true without either knowing the
                other's width. The row is `pointer-events: none`; the two
                clusters take it back, so the band between them is still the
                canvas's. */}
            <div className="editor-shell-stage-top">
              {/* What the author is editing, in the corner §7.5 gives identity.
                  It reads the store rather than a prop, so a bridge set after
                  the shell mounted — and a rename after that — reaches it too. */}
              <DocumentIdentity store={store} />
              {/* The store, not a local: a late-set bridge must reach the
                  readout the same way it reaches the inspector and menus. */}
              {store.bridge === undefined ? null : (
                <DisplaySwitch
                  viewport={store.bridge.editor.viewport}
                  artboard={store.bridge.editor.artboard}
                />
              )}
            </div>
            {/* The dock owns its own element and derives its own visibility;
                this is only the slot that puts its mount point in the stage. */}
            <Host node={hosts.dock} />
            {/* Renders no DOM of its own: it only binds the canvas's own
                `contextmenu` listener, so it sits with the stage it listens to. */}
            <CanvasContextMenu bridge={store.bridge} />
            {/* §7's reference, driven by the session's `?` dispatcher through
                this external store. Rendering it in the shell rather than a
                local `useEffect` listener keeps the manager the sole
                window-level dispatcher. */}
            <ShortcutReference
              open={sheetOpen}
              onOpenChange={(next) => sheet.set(next)}
            />
            {/* §7's settings modal. The gear's route is the rail's
                `onOpenSettings`; the modal returns focus to the gear itself.
                `storage` is the browser-local store the palette already uses. */}
            {/* The one place the finder is mounted. Its chord and its two menu
                entries all move this one store, the same way `?` moves the
                sheet's. */}
            <AssetFinder
              open={finderOpen}
              onOpenChange={(next) => finder.set(next)}
              bodies={{
                "font-picker": store.bridge?.session.fontPickerBody?.() ?? null,
                "wallpaper-engine":
                  store.bridge?.session.wallpaperEngineBody?.() ?? null,
              }}
              {...(finderState.category === undefined
                ? {}
                : { initialCategory: finderState.category })}
              onAction={async (page, result) => {
                const session = store.bridge?.session;
                if (session?.importAsset === undefined)
                  return {
                    ok: false,
                    message: uiCopy.assets.hostUnavailable,
                  };
                return session.importAsset(page, result);
              }}
              onOpenConnections={() => {
                finder.set(false);
                setSettingsTab("connections");
                setSettingsOpen(true);
              }}
            />
            <Settings
              open={settingsOpen}
              onOpenChange={(next) => {
                setSettingsOpen(next);
                if (!next) setSettingsTab(undefined);
              }}
              initialTab={settingsTab}
              storage={storage}
              palette={palette}
              following={following}
              onPalette={setPalette}
              onFollowing={setFollowing}
              overrides={overrides}
              onOverrides={applyOverrides}
              releaseVersion={releaseVersion}
            />
          </main>
          <aside className="editor-shell-inspector editor-glass">
            {/* One panel, so no tab strip: a strip with one tab is a control
                that cannot choose. The theme's own settings used to sit under
                this panel behind a `keepMounted` Design tab, which existed so
                a selection could not hide them; they are in the left column's
                Document pane now, which no selection can hide either, so the
                property is discharged by the move rather than by an attribute.
                A chart's own fields are still in this column — its owner is
                asked for them — so a chart keeps every question it has. */}
            <Host node={hosts.selection} />
            {kind !== "none" && (
              <p className="editor-shell-hint">{uiCopy.selectionHint}</p>
            )}
          </aside>
        </div>
        {/* The mode's own region — the seam a non-editor surface fills. A task
            that lands one replaces this element's body and nothing around it:
            the switch, the header, the status bar and the editor's own body are
            the shell's, and a region is what a mode adds. Each region is handed
            the mode rather than the shell choosing between them, so the two
            below mount together and one of them draws — and a mode with no
            surface yet renders an empty section rather than a placeholder
            standing in for one (§9). */}
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
              onOpenTheme={(id) => {
                void store.bridge?.session.openLibraryTheme(id, () =>
                  onModeChange("editor"),
                );
              }}
            />
            {/* The Host mode's region, beside the store's rather than chosen
                between here: each is handed the mode and draws itself in its
                own, so the section holds one surface whatever mode is showing.
                It takes no route from the shell — it writes this PC's own
                settings, and assigning a theme is the store's. */}
            <HostSettingsRegion mode={mode} onStatus={setHostStatus} />
          </section>
        )}
        {/* §7.6's strip: readouts only, the counts on the left and the save
            state and live mark on the right. The message span sits between the
            counts and the diagnostic, so a report is added to the left's
            reading rather than replacing it — the counts are what the author
            has when the editor is simply open, and a message is a moment.

            **It is one strip in every mode, and the Host mode's line is the
            host's rather than the editor's**: there is no document to count
            there, so its region publishes the two strings and this places them.
            A mode that publishes none draws the editor's readouts, which is
            what the store mode does. */}
        <footer id="status" className="editor-shell-status">
          {mode === "this-pc" ? (
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
          ) : (
            <>
              <StatusReadout store={store} />
              <Host node={hosts.status} />
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
   * **The guard fires on the way out of the editor and nowhere else.** Leaving
   * the editor is the only transition that can cost an unsaved document, so
   * moving between the other two modes asks nothing.
   *
   * It is the editor's **existing** replacement prompt with the switch's own
   * question, not a second guard: the prompt's copy is the only thing that makes
   * it read as a document replacement, so one instrument answers both, and it is
   * the one instrument that can offer **Save**. A `cancel` returns before the
   * mode moves; a `save` waits for the save to finish, so a failed one leaves the
   * author in the editor rather than past a guard that did not complete.
   *
   * **A failed save is read off the document, not off a return value.**
   * `savePackage()` resolves whether or not the save landed — the editor reports
   * its own failures — so the dirty mark is asked again after it. Still dirty
   * means the save did not happen, and the author stays where their work is.
   *
   * The question and the save are a promise the switch cannot hand back: its
   * handler returns `void`, so the promise is settled where it is created rather
   * than left floating for the runtime to report.
   */
  function ShellRoot(): React.JSX.Element {
    const [mode, setMode] = useState<ShellMode>("editor");
    const requestMode = (next: ShellMode): void => {
      if (next === mode) return;
      const session = mode === "editor" ? store.bridge?.session : undefined;
      if (session === undefined || session.isDirty() !== true) {
        setMode(next);
        return;
      }
      void (async () => {
        const choice = await confirmDocumentReplacement(uiCopy.modes.unsaved);
        if (choice === "cancel") return;
        if (choice === "save") {
          await session.savePackage();
          if (session.isDirty()) return;
        }
        setMode(next);
      })().catch(() => undefined);
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
    setBridge(nextBridge, nextView, nextPublish) {
      // The store notifies subscribers, so React re-renders the inspector and
      // menus without a manual root re-render — and it keeps working when the
      // bridge is replaced by a later document mount.
      view = nextView;
      publish = nextPublish;
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
    destroy() {
      store.bridge?.destroy();
      store.set(undefined);
      dockRoot.unmount();
      reactRoot?.unmount();
      reactRoot = undefined;
    },
  };
}
