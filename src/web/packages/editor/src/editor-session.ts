import {
  type FabricThemeEnvelope,
  type FabricThemeEnvelopeInput,
  type SampleSource,
} from "@yunari/renderer-core";
import { sceneBoxesOf } from "@yunari/scene-fabric";
import type { ThemeCreditsEntry } from "@yunari/theme-package";
import { ActiveSelection, type FabricObject } from "fabric/es";
import { createElement } from "react";
import { applyArrange, canArrange } from "./arrange.js";
import { type ArtboardPanel, createArtboardPanel } from "./artboard-panel.js";
import {
  creditOf,
  type ImportOutcome,
  importFinderResult,
} from "./asset-finder/actions.js";
import { assetBytes } from "./asset-finder/client.js";
import { FontsBodyHost } from "./asset-finder/fonts-body.js";
import {
  iconObject,
  iconShapes,
  placeIcon,
} from "./asset-finder/icon-shape.js";
import { WallpaperEngineBody } from "./asset-finder/wallpaper-engine-body.js";
import { type AssetManager, mimeOf } from "./asset-manager/index.js";
import {
  type CanvasNudge,
  createCanvasNudge,
  stepFor,
} from "./canvas-nudge.js";
import { ChartManager } from "./chart-manager/index.js";
import { EditorDocument } from "./editor-document.js";
import type { EditorActionFacade } from "./editor-shell/session-facade.js";
import { type EditorShell } from "./editor-shell.js";
import type { FavoritesClient } from "./favorites-client.js";
import { type CuratedFontFace } from "./font-catalog.js";
import { previewFontFace, releaseFontPreview } from "./font-preview.js";
import {
  createIndicatorManager,
  type IndicatorManager,
} from "./indicator-manager/index.js";
import { LiveRuntime } from "./live-runtime.js";
import type { NewDocumentAnswer } from "./new-document-chooser.js";
import { newInk } from "./new-object-defaults.js";
import {
  constructing,
  createNewObjectPanel,
  insertNewShape,
  insertNewText,
  type NewObjectPanel,
} from "./new-object-panel.js";
import {
  createPalettePanel,
  type PalettePanel,
  paletteTokenUsage,
} from "./palette-manager/index.js";
import type { PresetSelection } from "./panes/tokens/preset-list.js";
import type { RunDisplayMode } from "./run-placeholder.js";
import { typePresetOf } from "./selection-inspector/appearance.js";
import {
  createSelectionInspector,
  type SelectionInspector,
} from "./selection-inspector/index.js";
import { isTextObject } from "./selection-inspector/view.js";
import { ShortcutManager } from "./shortcut-manager/index.js";
import { createSnapManager, type SnapManager } from "./snap-manager/index.js";
import type { ThemeLibraryClient } from "./theme-library-client.js";
import {
  createTypePresetPanel,
  type TypePresetFontActions,
  type TypePresetPanel,
  type TypePresets,
} from "./type-preset-manager/index.js";
import { uiCopy } from "./ui-copy.js";
import { requestNormalizedVideo } from "./video-normalizer.js";
import {
  creditsEntryOf,
  fetchItemAsset,
  type WallpaperEngineItem,
} from "./wallpaper-engine/client.js";
import type { WallpaperExportOutcome } from "./wallpaper-engine/export-sheet.js";

/** How much of the artboard's shorter edge an imported icon takes. An SVG's
 *  viewBox is its own unit (24 for Lucide, 512 for Font Awesome), so its size
 *  says nothing about the frame it lands on; this is the one share every
 *  imported icon gets, which also makes two sources' glyphs comparable. */
const IMPORTED_ICON_SHARE = 0.12;

interface EditorPanelHosts {
  /** Text and chart creation, and the declared-asset library at its foot. */
  readonly add: HTMLElement;
  /** The theme's own paints and type presets, in the Tokens pane. */
  readonly tokens: HTMLElement;
  /** The document's own panels, in the Document pane: the artboard and the
      references it resolves. Shown by the pane, not by an empty selection — a
      theme setting must stay reachable while something is selected. */
  readonly document: HTMLElement;
  /** Properties of the selected object, in the right column. */
  readonly selection: HTMLElement;
}

interface EditorSessionOptions {
  readonly shell: EditorShell;
  readonly source: SampleSource;
  readonly envelope: FabricThemeEnvelopeInput;
  /**
   * The document's declared assets and their bytes, already loaded.
   *
   * Passed in rather than built here because the shell revives the scene before
   * this session exists, and Fabric enlivens an image from `src` alone: the
   * bytes have to be resolvable by then or a pasted image's dead `blob:` URL
   * costs the object itself, not just its picture. Whoever mounts a document
   * loads one manager and hands it to both.
   */
  readonly assetManager: AssetManager;
  /** The picture the opened package carried, if it carried one. A save that
   *  cannot render one of its own keeps this rather than losing it. */
  readonly thumbnail?: Uint8Array;
  readonly panelHosts: EditorPanelHosts;
  readonly libraryClient?: ThemeLibraryClient;
  /** Where the author's favourite font trios live — the host's settings, not
   *  the document. Absent reads as none, which is what a standalone editor
   *  has. */
  readonly favoritesClient?: FavoritesClient;
  /** The stored document this one was opened from, when it was opened from
   *  the library. Every save made from here is checked against it. */
  readonly libraryBase?: string;
  /** Creates a blank document at the artboard the author chose. The chooser
   *  itself is the session's, so the size is asked before the open document is
   *  even offered up for replacement. */
  readonly onNew: (answer: NewDocumentAnswer) => Promise<void>;
  /** Creates a document from the reference composition, as a template. */
  readonly onNewFromStarter: () => Promise<void>;
  /** Opens the package picker. **An import is a library write and not a
   *  document**: the theme lands where it survives the editor closing, so
   *  nothing is confirmed and nothing is forgotten on the way. */
  readonly onImportPackage?: () => void;
  /** §7's `?` reference. The sheet is chrome and belongs to `createShellLayout`,
   *  and the dispatcher belongs to this session, so the gesture crosses back
   *  through the same door every other modal prompt uses. Optional, so the four
   *  existing construction sites — and every test that builds a session — keep
   *  compiling and simply do nothing. */
  readonly onShowShortcuts?: () => void;
  /** The asset finder's modal lives in the shell, and its chord belongs to this
   *  dispatcher, so the gesture leaves through the shell's own door. Optional,
   *  like the two below, so a session built without chrome has no finder row. */
  readonly onFindAssets?: () => void;
  /** Opens the finder already on Fonts, which is where the catalogue browsed
   *  from the selection inspector's face field now lives. */
  readonly onFindFontPicker?: () => void;
  /** §7.1's `⌘⇧P`. The chord opens the publish surface and moves nothing: the
   *  host's switch is inside that surface, and reaching it is the author's
   *  second, deliberate press. Optional, like the one above, so a session built
   *  without a shell's chrome simply has no publish chord. */
  readonly onPublishSurface?: () => void;
  /** The shell's own projection of the selection, handed to the preset list so
   *  its chooser opens on the preset the selection is set in rather than on the
   *  first declared one (`vg-094`). Optional for the same reason as above. */
  readonly selection?: PresetSelection;
  readonly onOpenTheme?: (
    envelope: FabricThemeEnvelope,
    assets: Readonly<Record<string, Uint8Array>>,
    /** The stored document this one came from. Opening a theme builds a new
     *  session, so the base has to travel with it or the session replacing
     *  this one would save with no idea what it is based on. */
    base?: string,
  ) => Promise<void>;
  readonly onSaved: (message?: string) => void;
  readonly onError?: (message: string) => void;
  readonly onBindingsChange?: () => void;
  /** Nothing is saved behind this document — a draft restored after a crash.
   *  It reads as unsaved from its first frame, because it is: the work exists
   *  in the editor and in the draft, and nowhere else. */
  readonly unsaved?: boolean;
}

/** Owns Yunari editor composition on the native Fabric canvas. */
export class EditorSession {
  readonly charts: ChartManager;
  readonly #runtime: LiveRuntime;
  readonly #artboard: ArtboardPanel;
  readonly #palette: PalettePanel;
  readonly #types: TypePresetPanel;
  readonly #newObjects: NewObjectPanel;
  readonly #selection: SelectionInspector;
  readonly #snapping: SnapManager;
  readonly #indicators: IndicatorManager;
  readonly #assets: AssetManager;
  readonly #shortcuts = new ShortcutManager();
  readonly #nudge: CanvasNudge;
  readonly #options: EditorSessionOptions;
  /** The theme the author is editing. Every owner composed below is a view of
   *  it, so it is built first. */
  readonly #document: EditorDocument;
  /** The source the runtime reads, which a new source replaces. */
  #source: SampleSource;
  /** Releases the shell-selection subscription the background column follows. */
  #unsubscribeSelection: (() => void) | undefined;

  constructor(options: EditorSessionOptions) {
    if (options.shell.scene === undefined) {
      throw new Error(
        "The editor shell needs a scene adapter for Yunari extensions.",
      );
    }
    this.#options = options;
    this.#assets = options.assetManager;
    // Before the owners below, because they read the document as they mount;
    // the ones it fans out to are named here as ports and resolved when a
    // write happens.
    this.#document = new EditorDocument({
      source: options,
      consumers: {
        runtime: () => this.#runtime,
        charts: () => this.charts,
        newObjects: () => this.#newObjects,
        artboard: () => this.#artboard,
        palette: () => this.#palette,
        types: () => this.#types,
        selection: () => this.#selection,
      },
    });

    /**
     * An undo rebuilds the scene from JSON, and an imported image's persisted
     * `src` is the object URL `image-manager` revoked the moment it decoded.
     * The revived image therefore has nothing to draw and drops out of the
     * document — which is what made undo "remove the asset outright" instead
     * of undoing the transform, the move or the restack the author asked for.
     *
     * The package bytes are the authority, and `AssetManager.hydrate` is
     * already how a revived image is given them: the session ran it once, on
     * open, and never again.
     */
    options.shell.editor.canvas.on(
      "editor:history-state-loaded" as never,
      (() => {
        void this.hydrateAssets(options.shell).catch(() => undefined);
      }) as never,
    );

    // `history-manager` fires the first when a recorded edit lands, which is
    // the signal the rest of the shell already reads as "the document moved".
    // Adding and removing move it too, and are listed so the unsaved marker
    // does not depend on a path happening to record history.
    for (const event of [
      "editor:edit-committed",
      "object:added",
      "object:removed",
    ]) {
      options.shell.editor.canvas.on(
        event as never,
        this.#document.announceChange as never,
      );
    }

    // The File menu dispatches these through `actionFacade`; the section that
    // used to hold the buttons is gone.
    this.#snapping = createSnapManager({
      canvas: options.shell.editor.canvas,
      bounds: () => {
        const artboard = this.#document.envelope.artboard;
        return {
          left: 0,
          top: 0,
          right: artboard.width,
          bottom: artboard.height,
          centerX: artboard.width / 2,
          centerY: artboard.height / 2,
        };
      },
      errors: options.shell.editor.errorManager,
    });
    this.#indicators = createIndicatorManager({
      canvas: options.shell.editor.canvas,
    });
    this.#artboard = createArtboardPanel(
      options.panelHosts.document,
      (artboard) => this.#document.setArtboard(artboard),
      {
        onMetadataChange: (metadata) => this.#document.setMetadata(metadata),
        // The panel's own comment said the scene was not its to read, so it
        // stated a rule true at every size and therefore said nothing. It is
        // given the scene now that the counting lives with it.
        sceneBoxes: () =>
          sceneBoxesOf(options.shell.editor.canvas.getObjects()),
        // The figure is derived, so it needs the event that says the scene
        // moved. Without it the panel prints a number that only refreshes when
        // the artboard changes, and an author moving an object across the edge
        // sees no change on the surface they are looking at.
        canvasEvents: {
          on: (event, handler) =>
            options.shell.editor.canvas.on(event as never, handler as never),
          off: (event, handler) =>
            options.shell.editor.canvas.off(event as never, handler as never),
        },
      },
    );
    this.#artboard.render(
      this.#document.envelope.artboard,
      this.#document.envelope.metadata,
    );
    this.#palette = createPalettePanel(
      options.panelHosts.tokens,
      (palette) => this.#document.setPalette(palette),
      (id, replacement) => this.#document.deletePalette(id, replacement),
      {
        // The same walk the delete uses, so the figure beside a token and the
        // references a deletion will move cannot disagree about the scene.
        usage: () =>
          paletteTokenUsage(
            options.shell.editor.canvas,
            this.#document.envelope.globals?.palette ?? {},
          ),
      },
    );
    this.#palette.render(this.#document.envelope.globals?.palette);
    // The catalogue's three writes, built once because two surfaces ask this
    // session for them: the Tokens pane's own controls and the selection
    // inspector's face field are the same owner answering the same question
    // (`vg-268`), so neither re-implements a face or trio write.
    const fontActions: TypePresetFontActions = {
      preview: async (face) => {
        await this.#document.runFontAction(() => previewFontFace(face));
      },
      applyFace: async (id, face) => {
        await this.#document.runFontAction(() =>
          this.#document.applyPresetFace(id, face),
        );
      },
      applyTrio: async (id) => {
        await this.#document.runFontAction(() =>
          this.#document.applyFontTrio(id),
        );
      },
    };
    this.#types = createTypePresetPanel(
      options.panelHosts.tokens,
      (presets) => this.#document.setTypes(presets),
      (id, replacement) => this.#document.deleteType(id, replacement),
      fontActions,
      // The shell's own selection projection, so the list's chooser opens on
      // what the selection is set in. Pulled from the live snapshot rather than
      // a copy held here, because the selection is Fabric's.
      options.selection,
    );
    this.#types.render(
      this.#document.envelope.globals?.typePresets as TypePresets | undefined,
    );
    // The chart owner, built before the inspector that renders its fields: the
    // inspector is published with both halves of the port at construction, so
    // the owner has to exist by then.
    this.charts = new ChartManager({
      editor: options.shell.editor,
      scene: options.shell.scene,
      source: options.source,
      ...(this.#document.envelope.bindings === undefined
        ? {}
        : { bindings: this.#document.envelope.bindings }),
      ...(this.#document.envelope.globals === undefined
        ? {}
        : { globals: this.#document.envelope.globals }),
      onBindingsChange: (id, bindings) =>
        this.#document.setBindings(id, bindings),
    });
    this.#selection = createSelectionInspector(options.panelHosts.selection, {
      editor: options.shell.editor,
      ...(this.#document.envelope.globals === undefined
        ? {}
        : { globals: this.#document.envelope.globals }),
      // Bindings are envelope state, so the inspector reads and writes them
      // through the session rather than holding a second copy of them.
      nodeBindings: (id) => this.#document.envelope.bindings?.[id] ?? [],
      onNodeBindingsChange: (id, bindings) =>
        this.#document.setBindings(id, bindings),
      // Pulled, not held: the inspector must see the source the runtime is
      // using, not the one the session was constructed with.
      sampleSource: () => this.#source,
      // The shell owns the glass handle; the inspector writes the property and
      // asks it to re-resolve.
      refreshGlass: () => options.shell.refreshGlass(),
      // A chart's own fields and the writes they make, both pulled from the one
      // owner — so a chart's commit rules stay its own rather than being
      // restated in the inspector's generic dispatcher. The owner is built
      // above, before the inspector that reads it.
      chartFields: () => this.charts.fields,
      chartEdits: () => this.charts.edits,
      // The background is envelope state rather than a Fabric object, so its
      // four answers come from the shell's selection and the live document:
      // the flag from the shell's own projection, the value and the declared
      // pictures pulled at render time, and every write through the document
      // that owns the envelope.
      backgroundSelected: () =>
        options.selection?.get().activeKind === "background",
      background: () => this.#document.envelope.background,
      assets: () => this.#assets.declarations,
      onBackgroundChange: (next) => this.#document.setBackground(next),
      // The face field's writes are the catalogue's own, above; the favourites
      // it browses by are the host's, so the client travels rather than a list.
      fontActions,
      ...(options.favoritesClient === undefined
        ? {}
        : { favoritesClient: options.favoritesClient }),
      ...(options.onFindFontPicker === undefined
        ? {}
        : { onOpenFontPicker: options.onFindFontPicker }),
    });
    this.#selection.setLocale(this.#document.envelope.metadata?.themeLanguage);
    // Selecting the background row is a shell selection with no Fabric object:
    // its `selection:cleared` fires before the bridge sets the flag, so the
    // canvas events the inspector already follows cannot report it. The store
    // notifies after the flag moves, and that is the render that shows the
    // background's column.
    this.#unsubscribeSelection = options.selection?.subscribe(() =>
      this.#selection.render(),
    );
    // Entering inline editing asks the runtime for the authoring view: the
    // shell built the text manager before this session existed, so the
    // dependency is installed here rather than passed in.
    options.shell.editor.textManager.setAuthoringView((object) =>
      this.#runtime.showAuthoringView(object),
    );
    // A refused in-place edit left Fabric's flat text standing where the
    // authored runs belong. The runtime owns what an object paints, so the
    // put-back goes through it rather than a second repaint path here.
    options.shell.editor.textManager.setRepaint(() => this.#runtime.refresh());
    this.#newObjects = createNewObjectPanel(
      options.panelHosts.add,
      options.shell.editor,
      this.#document.envelope.globals,
      {
        addChart: (family) => this.charts.addChart(family),
        insertCard: (cardId) => this.#document.insertCard(cardId),
      },
      // The file path travels in the Add pane rather than beside it (`§5.2`),
      // so the manager, the reference check and the re-resolve are handed to
      // the panel that already owns the pane's body.
      {
        manager: this.#assets,
        changed: () => {
          // The background column offers the declared pictures, so a picture
          // that lands while the background is selected is offered then rather
          // than at the next selection change.
          this.#selection.render();
          this.#document.refreshBackgroundMedia();
        },
        isReferenced: (assetId) => this.#document.holdsAsset(assetId),
        onFindAssets: () => options.onFindAssets?.(),
      },
    );
    this.#source = options.source;
    this.#runtime = new LiveRuntime({
      canvas: options.shell.editor.canvas,
      source: options.source,
      ...(this.#document.envelope.bindings === undefined
        ? {}
        : { bindings: this.#document.envelope.bindings }),
      ...(this.#document.envelope.globals === undefined
        ? {}
        : { globals: this.#document.envelope.globals }),
      ...(this.#document.envelope.metadata?.themeLanguage === undefined
        ? {}
        : { themeLanguage: this.#document.envelope.metadata.themeLanguage }),
    });
    // A pasted image must be a declared asset, not a blob URL: the half-only
    // path saves a document whose image is a handle into this session's memory
    // and is gone from every other tab, every other browser and every reload —
    // silently, because the save succeeds.
    options.shell.editor.clipboardManager.setImageImporter((file) =>
      this.#assets.placeImage(options.shell.editor, file),
    );
    // Same reason, same shape: a pasted or duplicated object is given a new id
    // by the clipboard, and a binding is keyed by the object that shows it, so
    // the copy's readings have to be re-keyed by whoever owns the envelope.
    // Without this a duplicated card arrives claiming to be a CPU card, shows
    // nothing, and its runs point at the original's binding ids — which the
    // validator refuses as a duplicate, so the save fails for the session.
    options.shell.editor.clipboardManager.setBindings({
      read: () => this.#document.envelope.bindings ?? {},
      write: (bindings) => this.#document.addBindings(bindings),
    });
    this.#document.refreshBackgroundMedia();
    this.#shortcuts.register("file.save", () => {
      void this.#document.save();
    });
    // The File menu's row carries this chord, and the row reads *Import
    // package*: the chord does what the control it is printed beside does.
    this.#shortcuts.register("file.open", () => {
      options.onImportPackage?.();
    });
    this.#shortcuts.register("file.new", () => {
      void this.#document.newDocument();
    });
    this.#shortcuts.register("file.findAssets", () => {
      options.onFindAssets?.();
    });
    this.#shortcuts.register("edit.undo", () => {
      // First: a burst's entry is not recorded until it closes, so an undo
      // inside the idle window would find nothing to step back to.
      this.#nudge.endBurst();
      void options.shell.editor.historyManager.undo();
    });
    this.#shortcuts.register("edit.redo", () => {
      this.#nudge.endBurst();
      void options.shell.editor.historyManager.redo();
    });
    this.#shortcuts.register("edit.delete", () => {
      options.shell.editor.deletionManager.deleteActive();
    });
    this.#shortcuts.register("edit.copy", () => {
      void options.shell.editor.clipboardManager.copy();
    });
    this.#shortcuts.register("edit.cut", () => {
      void options.shell.editor.clipboardManager.cut();
    });
    this.#shortcuts.register("edit.duplicate", () => {
      void options.shell.editor.clipboardManager.duplicate();
    });
    this.#shortcuts.register("edit.group", () => {
      options.shell.editor.groupingManager.group();
    });
    this.#shortcuts.register("edit.ungroup", () => {
      options.shell.editor.groupingManager.ungroup();
    });
    // Context-only, so it is registered here rather than in `PRODUCT_SHORTCUTS`:
    // no menu or tooltip displays "Escape".
    this.#shortcuts.register("view.exit-group", () => {
      options.shell.editor.groupingManager.exitGroup();
    });
    // §7's `?` reference. The manager dispatches; the sheet is chrome and lives
    // in the shell, so the gesture leaves through the session's own callback.
    this.#shortcuts.register("help.shortcuts", () => {
      options.onShowShortcuts?.();
    });
    // The header prints this chord beside the publish control, so it does what
    // that control does — opens the surface — and nothing of its own. The host
    // is moved only by the switch inside the surface.
    this.#shortcuts.register("publish.surface", () => {
      options.onPublishSurface?.();
    });
    this.#shortcuts.register("canvas.front", () => {
      options.shell.editor.layerManager.bringToFront();
    });
    this.#shortcuts.register("canvas.back", () => {
      options.shell.editor.layerManager.sendToBack();
    });

    const canvas = options.shell.editor.canvas;
    // The theme's full-artboard background rect is `selectable: false`, but it
    // *is* returned by `getObjects()`. Selecting it would let the next nudge or
    // drag move the background off the artboard, so it is filtered out here.
    // Locked objects are selectable now, so this filter no longer excludes
    // them; `object-lock-manager` owns that, dropping locked members from a
    // selection once it exists. Snapping makes the opposite call — a locked
    // object *is* alignable against — so this filter is deliberately stricter
    // than `snap-manager`'s.
    const selectableObjects = (): FabricObject[] =>
      canvas.getObjects().filter((object) => object.selectable === true);

    this.#shortcuts.register("canvas.select-all", () => {
      const objects = selectableObjects();
      // An `ActiveSelection` of one object is not a selection.
      if (objects.length < 2) return;
      canvas.discardActiveObject();
      canvas.setActiveObject(new ActiveSelection(objects, { canvas }));
      canvas.requestRenderAll();
    });

    this.#nudge = createCanvasNudge({
      canvas,
      history: options.shell.editor.historyManager,
    });

    // Four literal registrations, not a loop over a key map: `ProductShortcutId`
    // is a closed union and a template literal is not assignable to it without a
    // cast.
    this.#shortcuts.register("canvas.nudge-left", (event) => {
      this.#nudge.nudgeBy(-stepFor(event), 0);
    });
    this.#shortcuts.register("canvas.nudge-right", (event) => {
      this.#nudge.nudgeBy(stepFor(event), 0);
    });
    this.#shortcuts.register("canvas.nudge-up", (event) => {
      this.#nudge.nudgeBy(0, -stepFor(event));
    });
    this.#shortcuts.register("canvas.nudge-down", (event) => {
      this.#nudge.nudgeBy(0, stepFor(event));
    });
  }

  get envelope(): FabricThemeEnvelopeInput {
    return this.#document.envelope;
  }

  /** The document as the author last left it: what a save ships, and what the
   *  draft holds (`vg-040`). Read here rather than composed at the caller, so
   *  the authored-JSON merge the snapshot is stays the document's — a second
   *  one at the boot path would drop the asset declarations with it. */
  snapshot(): FabricThemeEnvelope {
    return this.#document.snapshot();
  }

  /**
   * One Wallpaper Engine item's import: the host's payload bytes, then the
   * shared transaction below.
   */
  async importWallpaperItem(item: WallpaperEngineItem): Promise<ImportOutcome> {
    const file = await fetchItemAsset(item);
    if (file === undefined) {
      return {
        ok: false,
        message: uiCopy.assets.bytesUnavailable(item.title),
      };
    }

    // §15: a video crosses the host's envelope before the manager sees it, and
    // the normalizer's refusal — never a sentence composed here — is the
    // authority. An image is imported as served.
    if (item.kind !== "video")
      return this.importWallpaperFile(item, file, "Copied unchanged");

    const normalized = await normalizeWallpaperVideo(file);
    if (!normalized.ok) return { ok: false, message: normalized.message };
    return this.importWallpaperFile(
      item,
      normalized.file,
      normalized.reencoded
        ? "Re-encoded to the publish envelope"
        : "Copied unchanged",
    );
  }

  /** A scene's exported file: a PNG is an image asset, and an MP4 crosses the
   *  same normalizer a video item does (§8 step 6). */
  async importWallpaperExport(
    item: WallpaperEngineItem,
    file: File,
  ): Promise<WallpaperExportOutcome> {
    const changes = uiCopy.assets.wallpaperEngine.scene.changes;
    if (!isVideoFile(file))
      return this.importWallpaperFile(item, file, changes);

    const normalized = await normalizeWallpaperVideo(file);
    if (!normalized.ok) return { ok: false, message: normalized.message };
    return this.importWallpaperFile(
      item,
      normalized.file,
      normalized.reencoded ? "Re-encoded to the publish envelope" : changes,
    );
  }

  /**
   * The one transaction both Wallpaper Engine imports run: the manager's caps
   * and reference model, the credit, and the background consequence an image
   * import has. The credit is written first, the same order `importAsset` uses
   * — an import that places nothing still carries its attribution.
   */
  async importWallpaperFile(
    item: WallpaperEngineItem,
    file: File,
    changes: string,
  ): Promise<WallpaperExportOutcome> {
    const credit: ThemeCreditsEntry = { ...creditsEntryOf(item), changes };
    if (!this.#document.canAddCredit(credit)) {
      return { ok: false, message: uiCopy.assets.creditsFull };
    }

    try {
      const reference = await this.#assets.import(file);
      this.#document.addCredit(credit);
      const background = this.#document.envelope.background;
      this.#document.setBackground({
        ...background,
        media: {
          assetId: reference.id,
          bounds: background?.media?.bounds ?? "theme",
        },
      });
      this.#document.refreshBackgroundMedia();
      return { ok: true, assetId: reference.id };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Reachability only: the shell menus dispatch through the existing owners,
   * including the private document actions the panel section used to call. */
  actionFacade(): EditorActionFacade {
    const options = this.#options;
    const editor = options.shell.editor;
    return {
      newDocument: () => this.#document.newDocument(),
      newFromStarter: () => this.#document.newFromStarter(),
      // The picker, and nothing of the document's: an import lands in the
      // library while whatever is open stays open.
      importPackage: () => options.onImportPackage?.(),
      savePackage: () => this.#document.save(),
      releasePackage: () => this.#document.release(),
      openLibrary: () => this.#document.openLibrary(),
      // The finder's Fonts body. The catalogue's data and the two writes are
      // the session's already; the shell only has somewhere to put the body.
      // A face applies to the preset the selected text is set in — the same
      // reading the inspector's own field performed before the picker moved.
      fontPickerBody: () =>
        createElement(FontsBodyHost, {
          ...(options.favoritesClient === undefined
            ? {}
            : { favoritesClient: options.favoritesClient }),
          onApplyFace: (face) => {
            const active = editor.canvas.getActiveObject();
            const ref =
              active !== undefined && isTextObject(active)
                ? typePresetOf(active)
                : undefined;
            if (ref !== undefined) {
              void this.applyPresetFace(ref.slice("typePresets.".length), face);
            }
          },
          onApplyTrio: (trioId) => {
            void this.applyFontTrio(trioId);
          },
        }),
      // The finder's Wallpaper Engine body. The listing is the body's own fetch
      // — it is a library, not a search — so the session owns only the import a
      // row triggers.
      wallpaperEngineBody: () =>
        createElement(WallpaperEngineBody, {
          onImport: (item) => this.importWallpaperItem(item),
          onImportExport: (item, file) =>
            this.importWallpaperExport(item, file),
        }),
      // One finder row's action. The bytes come from the host, the manager
      // keeps its caps and sanitising, and the credit is written before the
      // asset's own consequence runs — an import that places nothing still
      // carries its attribution.
      importAsset: async (page, result) => {
        const fetched = await assetBytes(page.source, result.id);
        if (fetched === undefined)
          return {
            ok: false as const,
            message: uiCopy.assets.bytesUnavailable(result.name),
          };

        // An icon is authored as geometry, not as a picture: the starter theme's
        // icons are paths for the same reason — a path takes the theme's ink, a
        // stroke width and a shadow, and an SVG image takes none of them.
        if (result.kind === "icon") {
          const credit = creditOf(result);
          if (!this.#document.canAddCredit(credit))
            return { ok: false as const, message: uiCopy.assets.creditsFull };

          try {
            const artboard = this.#document.envelope.artboard;
            const ink = newInk(this.#document.envelope.globals);
            const shapes = await iconShapes(
              new TextDecoder().decode(fetched.bytes),
              ink,
            );
            if (shapes.length === 0)
              return { ok: false as const, message: uiCopy.assets.emptyIcon };

            const placed = iconObject(
              shapes,
              result.name,
              `icon-${crypto.randomUUID()}`,
            );
            placeIcon(placed, artboard, IMPORTED_ICON_SHARE);
            this.#document.addCredit(credit);
            editor.canvas.add(placed);
            editor.canvas.setActiveObject(placed);
            editor.historyManager.saveState();
            editor.canvas.requestRenderAll();
            return { ok: true as const };
          } catch (error) {
            // A glyph the parser refuses, or a theme with no palette to paint
            // it: the author gets the reason in the dialog, not a dead button.
            return {
              ok: false as const,
              message: error instanceof Error ? error.message : String(error),
            };
          }
        }

        const file = new File(
          [fetched.bytes as unknown as BlobPart],
          fetched.filename,
          { type: mimeOf(fetched.filename) ?? "" },
        );
        const outcome = await importFinderResult({
          page,
          result,
          bytes: fetched.bytes,
          filename: fetched.filename,
          manager: this.#assets,
          document: this.#document,
          place: (assetId) => {
            if (result.kind === "image") {
              // The background is a layer now, and its media carries the box it
              // fills. A newly placed picture keeps the box it was fitted to and
              // starts unmirrored and centred.
              const background = this.#document.envelope.background;
              this.#document.setBackground({
                ...background,
                media: {
                  assetId,
                  bounds: background?.media?.bounds ?? "theme",
                },
              });
              return;
            }
            // Every other declared picture is placed through the Add pane's own
            // path: `placeImage` takes the declaration this import just made, so
            // the file is not imported twice. (An icon never reaches here — it
            // is authored as geometry above.)
            const declared = this.#assets.declarations.find(
              (entry) => entry.id === assetId,
            );
            if (declared !== undefined) {
              void this.#assets
                .placeImage(editor, file, declared)
                .catch((error: unknown) =>
                  options.onError?.(
                    error instanceof Error ? error.message : String(error),
                  ),
                );
            }
          },
        });
        if (outcome.ok === true) {
          // A finder import makes a declaration just as the Add pane's own file
          // does, and a declared asset is what the background layer resolves its
          // bytes through.
          this.#document.refreshBackgroundMedia();
        }
        return outcome.ok
          ? { ok: true as const }
          : { ok: false as const, message: outcome.message };
      },
      openLibraryTheme: (id, onAccepted) =>
        this.#document.openLibraryTheme(id, onAccepted),
      saveLibrary: () => this.#document.saveLibrary(),
      // The three constructions the shell dispatches are wrapped in the one
      // owner of a construction's refusal (`new-object-panel.ts`), because the
      // surfaces that reach them — the layer footer through `bridge.run`, and
      // the canvas context menu through `creationGroups` — both hold a `void`
      // and cannot report a throw themselves (`vg-484`). `insertCard` is not
      // wrapped: the document reports that one at its own owner.
      addText: () =>
        constructing(editor, () =>
          insertNewText(editor, this.#document.envelope.globals),
        ),
      addShape: (kind) =>
        constructing(editor, () =>
          insertNewShape(editor, this.#document.envelope.globals, kind),
        ),
      addChart: (family) =>
        constructing(editor, () => this.charts.addChart(family)),
      insertCard: (cardId) => this.#document.insertCard(cardId),
      arrange: (action) => applyArrange(editor, action),
      canArrange: (action) => canArrange(editor, action),
      undo: () => void editor.historyManager.undo(),
      redo: () => void editor.historyManager.redo(),
      copy: () => void editor.clipboardManager.copy(),
      cut: () => void editor.clipboardManager.cut(),
      deleteActive: () => void editor.deletionManager.deleteActive(),
      duplicate: () => void editor.clipboardManager.duplicate(),
      group: () => editor.groupingManager.group(),
      ungroup: () => editor.groupingManager.ungroup(),
      isDirty: () => this.isDirty(),
      publishableDocument: () => {
        // A document with no stored base has no folder, and a published
        // document's assets are served from the theme's own folder — so a
        // display given one would render a theme with holes. The base's own
        // `id` is a content hash of the stored document, not the folder it
        // lives in, so the id published under is the document's.
        if (!this.#document.isStored()) return undefined;
        const envelope = this.#document.snapshot();
        return { id: envelope.id, envelope };
      },
      subscribeDocumentChange: (listener) =>
        this.subscribeDocumentChange(listener),
    };
  }

  setSource(source: SampleSource): void {
    this.#source = source;
    this.#runtime.setSource(source);
    this.charts.setSource(source);
  }

  refresh(): void {
    this.#runtime.refresh();
    this.charts.refresh();
  }

  /**
   * The refresh loop's own call, and a separate method from `refresh` because
   * the two halves of a repaint want different cadences.
   *
   * Charts animate, so they keep the author's rate. Text does not: a reading
   * that changes once a second was being re-measured thirty times a second
   * across every text object in the document, which cost the same whether the
   * author was mid-gesture or had walked away. `LiveRuntime.tick` owns the two
   * text cadences; this is the loop asking for them beside the charts.
   */
  tick(): void {
    this.#runtime.tick();
    this.charts.refresh();
  }

  /** How value runs read while authoring (§89). */
  runDisplay(): RunDisplayMode {
    return this.#runtime.runDisplay;
  }

  setRunDisplay(mode: RunDisplayMode): void {
    this.#runtime.setRunDisplay(mode);
  }

  async hydrateAssets(shell: EditorShell): Promise<void> {
    await this.#assets.hydrate(shell.editor.canvas);
  }

  applyFontTrio(id: string): Promise<FabricThemeEnvelope> {
    return this.#document.applyFontTrio(id);
  }

  applyPresetFace(
    id: string,
    face: CuratedFontFace,
  ): Promise<FabricThemeEnvelope> {
    return this.#document.applyPresetFace(id, face);
  }

  destroy(): void {
    this.#unsubscribeSelection?.();
    this.#shortcuts.destroy();
    this.#nudge.dispose();
    this.#document.destroy();
    this.#assets.destroy();
    releaseFontPreview();
    this.charts.destroy();
    this.#selection.root.remove();
    this.#artboard.destroy();
    this.#palette.destroy();
    this.#types.destroy();
    this.#newObjects.destroy();
    this.#snapping.destroy();
    this.#indicators.destroy();
  }

  /** Whether the document differs from what was last saved. Pulled, never held:
   *  the comparison already exists for the replace prompt, and a stored flag
   *  would be one more thing to keep true. */
  isDirty(): boolean {
    return this.#document.isDirty();
  }

  /** Told "look again", not told the answer: a path that announces without
   *  having changed anything costs a recompute rather than a wrong marker. */
  subscribeDocumentChange(listener: () => void): () => void {
    return this.#document.subscribeDocumentChange(listener);
  }
}

/** One video, through the host's envelope. Used by both entries that take one:
 *  an item's payload and a scene's export. */
async function normalizeWallpaperVideo(
  file: File,
): Promise<
  | { readonly ok: true; readonly file: File; readonly reencoded: boolean }
  | { readonly ok: false; readonly message: string }
> {
  const normalized = await requestNormalizedVideo(
    new Uint8Array(await file.arrayBuffer()),
  );
  if (!normalized.ok) return normalized;
  return {
    ok: true,
    file: new File(
      [normalized.bytes as unknown as BlobPart],
      mp4NameOf(file.name),
      { type: "video/mp4" },
    ),
    reencoded: normalized.reencoded,
  };
}

/** The host's content type is the first answer; the name covers a host that
 *  served the export as octet-stream. */
function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/") || /\.mp4$/i.test(file.name);
}

/** The normalizer answers MP4, so the manager's extension check sees what the
 *  bytes are even when the wallpaper's own file was another container. */
function mp4NameOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return `${dot <= 0 ? name : name.slice(0, dot)}.mp4`;
}
