import {
  type FabricThemeEnvelope,
  type FabricThemeEnvelopeInput,
  FONT_ASSET_FORMATS,
  type FontCut,
  type SampleSource,
  SEMANTIC_KEYS,
  type SemanticKeyDescriptor,
} from "@yunari/renderer-core";
import { type ChartRefreshRate, sceneBoxesOf } from "@yunari/scene-fabric";
import {
  MAX_CREDITS_ENTRIES,
  type ThemeCreditsEntry,
} from "@yunari/theme-package";
import { ActiveSelection, type FabricObject } from "fabric/es";
import { createElement, type ReactElement } from "react";
import { applyArrange, canArrange } from "./arrange.js";
import { type ArtboardPanel, createArtboardPanel } from "./artboard-panel.js";
import {
  applyPreset,
  creditOf,
  type ImportOutcome,
  importFinderResult,
} from "./asset-finder/actions.js";
import { assetBytes } from "./asset-finder/client.js";
import { FontsBody } from "./asset-finder/fonts-body.js";
import {
  iconObject,
  iconShapes,
  placeIcon,
} from "./asset-finder/icon-shape.js";
import { WallpaperEngineBody } from "./asset-finder/wallpaper-engine-body.js";
import {
  ASSET_FILE_EXTENSIONS,
  type AssetImportMetadata,
  type AssetManager,
  mimeOf,
} from "./asset-manager/index.js";
import {
  type CanvasNudge,
  createCanvasNudge,
  stepFor,
} from "./canvas-nudge.js";
import { ChartManager } from "./chart-manager/index.js";
import { openFontImportDialog } from "./components/font-import-dialog.js";
import { EditorDocument } from "./editor-document.js";
import type { EditorActionFacade } from "./editor-shell/session-facade.js";
import type {
  TokenRef,
  TokenSelectionStore,
} from "./editor-shell/shell-stores.js";
import { type EditorShell } from "./editor-shell.js";
import type { FavoritesClient } from "./favorites-client.js";
import { type CuratedFontFace } from "./font-catalog.js";
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
  type PaletteTokenUse,
  paletteTokenUsage,
} from "./palette-manager/index.js";
import {
  createAssetsPane,
  type FontCommitInput,
} from "./panes/assets/assets-pane.js";
import { fontMetadataFromFilename } from "./panes/assets/font-metadata-form.js";
import type { VideoImportStep } from "./panes/assets/import-video-modal.js";
import {
  createTokenInspectorPanel,
  type TokenInspectorPanel,
} from "./panes/tokens/token-inspector.js";
import type { PresetSelection } from "./panes/tokens/token-list.js";
import { weightChoices } from "./panes/tokens/weight-choices.js";
import {
  createSelectionInspector,
  type SelectionInspector,
} from "./selection-inspector/index.js";
import type { SensorCatalogue } from "./sensor-catalogue.js";
import { ShortcutManager } from "./shortcut-manager/index.js";
import { createSnapManager, type SnapManager } from "./snap-manager/index.js";
import type { ThemeLibraryClient } from "./theme-library-client.js";
import {
  createTypeTokenPanel,
  type TypeTokenFontActions,
  type TypeTokenPanel,
  type TypeTokens,
} from "./type-preset-manager/index.js";
import { uiCopy } from "./ui-copy.js";
import { requestNormalizedVideo } from "./video-normalizer.js";
import {
  creditsEntryOf,
  fetchAuthorName,
  fetchItemAsset,
  mp4NameOf,
  prepareMobilePackage,
  startProject,
  type WallpaperEngineItem,
} from "./wallpaper-engine/client.js";

/** How much of the artboard's shorter edge an imported icon takes. An SVG's
 *  viewBox is its own unit (24 for Lucide, 512 for Font Awesome), so its size
 *  says nothing about the frame it lands on; this is the one share every
 *  imported icon gets, which also makes two sources' glyphs comparable. */
const IMPORTED_ICON_SHARE = 0.12;

/** The font formats the manager packages, so the picker offers no file the
 *  importer refuses. A `font/*` pattern would offer `.ttc` and every other face
 *  format the package cannot carry. */
const FONT_FILE_ACCEPT = ASSET_FILE_EXTENSIONS.filter((extension) =>
  (FONT_ASSET_FORMATS as readonly string[]).includes(extension),
)
  .map((extension) => `.${extension}`)
  .join(",");

interface EditorPanelHosts {
  /** Text and chart creation, and the card library. */
  readonly add: HTMLElement;
  /** The declared files, their import and placement, in the Assets pane. */
  readonly assets: HTMLElement;
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
  /** The author's chart refresh rate; absent keeps the 30 fps default. */
  readonly chartRefreshRate?: () => ChartRefreshRate;
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
  /** The package's attribution member, when the session opens one: the
   *  collection every later import is added to. */
  readonly credits?: readonly ThemeCreditsEntry[];
  readonly panelHosts: EditorPanelHosts;
  readonly libraryClient?: ThemeLibraryClient;
  /** The readings the editor's pickers offer, from the host's sensor wire. A
   *  session built without one still offers the built-in vocabulary, which is
   *  what a disconnected editor has. */
  readonly sensors?: SensorCatalogue;
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
   *  it says what the canvas selection is set in rather than showing the first
   *  declared preset (`vg-094`). Optional for the same reason as above. */
  readonly selection?: PresetSelection;
  /** The shell's token selection, handed to the preset list so a row press
   *  reaches the store the inspector reads. Optional, like `selection`. */
  readonly tokenSelection?: TokenSelectionStore;
  /** The Assets pane's title count. The store is the shell chrome's, so the
   *  session reports the manager's declaration count rather than the shell
   *  reaching for a manager it does not hold. */
  readonly onAssetCountChange?: (count: number) => void;
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
  readonly #types: TypeTokenPanel;
  readonly #newObjects: NewObjectPanel;
  readonly #assetsPanel: { destroy(): void };
  readonly #selection: SelectionInspector;
  /** The selected token's own column, a sibling section of the object
   *  inspector's under the same host. */
  readonly #tokenInspector: TokenInspectorPanel;
  /** Releases the token-selection subscription the inspector follows. */
  #unsubscribeTokenSelection: (() => void) | undefined;
  /** Releases the document-change subscription the inspector re-renders on. */
  #unsubscribeTokenDocument: (() => void) | undefined;
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
    // The one walk behind both the figure beside a token and the users list in
    // the inspector, so the two cannot disagree about the scene.
    const paletteUsage = (): Readonly<
      Record<string, readonly PaletteTokenUse[]>
    > =>
      paletteTokenUsage(
        options.shell.editor.canvas,
        this.#document.envelope.globals?.palette ?? {},
      );
    this.#palette = createPalettePanel(
      options.panelHosts.tokens,
      (palette) => this.#document.setPalette(palette),
      {
        // The same walk the delete uses, so the figure beside a token and the
        // references a deletion will move cannot disagree about the scene.
        usage: paletteUsage,
        // Live edits publish on every sample; the history entry is made once,
        // when the picker says the gesture ended.
        onSettled: () => options.shell.editor.historyManager.saveState(),
        // A row press hands the token to the inspector; the store owns the
        // canvas clear (ruling 2), so the pane never reaches Fabric.
        tokenSelection: options.tokenSelection,
      },
    );
    this.#palette.render(this.#document.envelope.globals?.palette);
    // The catalogue's three writes, built once because two surfaces ask this
    // session for them: the Tokens pane's own controls and the selection
    // inspector's face field are the same owner answering the same question
    // (`vg-268`), so neither re-implements a face or trio write.
    const fontActions: TypeTokenFontActions = {
      applyFace: async (id, face) => {
        await this.#document.runFontAction(() =>
          this.applyPresetFace(id, face),
        );
      },
      applyTrio: async (id) => {
        await this.#document.runFontAction(() => this.applyFontTrio(id));
      },
    };
    this.#types = createTypeTokenPanel(
      options.panelHosts.tokens,
      (presets) => this.#document.setTypes(presets),
      (id, replacement) => this.#deleteType(id, replacement),
      fontActions,
      // The shell's own selection projection, so the list says what the canvas
      // selection is set in. Pulled from the live snapshot rather than a copy
      // held here, because the selection is Fabric's.
      options.selection,
      // The token a row press selects, which the inspector will read.
      options.tokenSelection,
    );
    this.#types.render(
      this.#document.envelope.globals?.typeTokens as TypeTokens | undefined,
    );
    // The chart owner, built before the inspector that renders its fields: the
    // inspector is published with both halves of the port at construction, so
    // the owner has to exist by then.
    const descriptors = (): readonly SemanticKeyDescriptor[] =>
      options.sensors?.descriptors() ?? SEMANTIC_KEYS;
    this.charts = new ChartManager({
      editor: options.shell.editor,
      scene: options.shell.scene,
      source: options.source,
      descriptors,
      refreshRate: options.chartRefreshRate ?? (() => 30),
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
      // The readings the run picker offers, pulled for the same reason: a
      // catalogue refreshed after mount is visible on the next projection.
      descriptors,
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
      // Both finder ports are the shell's one port: the face field's row and the
      // run row's action entry open the same finder. The import opens Task 4.2's
      // dialog and names its token back so the run that asked can point itself
      // at it.
      ...(options.onFindFontPicker === undefined
        ? {}
        : {
            onOpenFontPicker: options.onFindFontPicker,
            openFontFinder: options.onFindFontPicker,
          }),
      importLocalFont: (onImported) => this.#pickFontFile(onImported),
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
    // The selected token's own properties, in the same host as the object
    // column — exactly one of the two draws. The session owns both halves: the
    // document's writes (which reach history through `setTypes`) and the
    // suppression the token selection drives. A new surface built in
    // `shell-layout` would need a second copy of the document.
    this.#tokenInspector = createTokenInspectorPanel(
      options.panelHosts.selection,
      {
        onChange: (presets) => this.#document.setTypes(presets),
        // The same port the preset library is handed: one delete route, so the
        // reference reassignment and the token clear cannot disagree.
        onDelete: (id, replacement) => this.#deleteType(id, replacement),
        unbindFace: (id) => this.#document.unbindPresetFace(id),
        // The package's own faces, so a bound preset's weight is chosen from
        // what it holds rather than typed into a fallback. A packaged family
        // declares one face per subset, so the list collapses each
        // weight-and-style group to one entry before the control sees it. The
        // family is compared case-insensitively, as `familiesOf` deduplicates
        // it: a token kept as `inter` is still on the declared `Inter`.
        facesOf: (family) =>
          weightChoices(
            options.assetManager.declarations.flatMap((asset) =>
              asset.kind === "font" &&
              "family" in asset &&
              asset.family.toLowerCase() === family.toLowerCase()
                ? [
                    {
                      assetId: asset.id,
                      weight: asset.weight,
                      style: asset.style,
                    },
                  ]
                : [],
            ),
          ),
        // The package's families for the family list, and the two action rows:
        // each is drawn only where its port exists.
        familiesOf: () => declaredFamilies(options.assetManager.declarations),
        importLocalFont: () => this.#pickFontFile(),
        ...(options.onFindFontPicker === undefined
          ? {}
          : { openFontFinder: options.onFindFontPicker }),
        // The paint half: the selected paint token's fields write through the
        // same document and history ports as the pane's rows once did.
        paints: {
          palette: () => this.#document.envelope.globals?.palette ?? {},
          onChange: (palette) => this.#document.setPalette(palette),
          onSettled: () => options.shell.editor.historyManager.saveState(),
          onDelete: (id, replacement) => this.#deletePalette(id, replacement),
          usage: paletteUsage,
        },
      },
    );
    const renderTokenInspector = (): void => {
      const held = options.tokenSelection?.get();
      // A token the document no longer declares keeps the object column
      // suppressed over a blank section — the shape an undo of Add leaves, not
      // only the delete routes. Dropping the ref here re-enters through the
      // store's subscription with no token and gives the column back.
      if (held !== undefined && !this.#tokenExists(held)) {
        options.tokenSelection?.clear();
      }
      const token = options.tokenSelection?.get();
      this.#selection.setSuppressed(token !== undefined);
      this.#tokenInspector.render(
        token,
        (this.#document.envelope.globals?.typeTokens ?? {}) as TypeTokens,
        this.#document.envelope.globals,
      );
    };
    // A canvas selection clears the token store, which notifies here; a type
    // edit announces through the document, which re-renders the fields with the
    // value just written.
    this.#unsubscribeTokenSelection =
      options.tokenSelection?.subscribe(renderTokenInspector);
    this.#unsubscribeTokenDocument =
      this.#document.subscribeDocumentChange(renderTokenInspector);
    renderTokenInspector();
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
        addText: () => this.#armText(),
        addChart: (family) => this.charts.addChart(family),
        insertCard: (cardId) => this.#document.insertCard(cardId),
      },
    );
    this.#assetsPanel = createAssetsPane(options.panelHosts.assets, {
      manager: this.#assets,
      editor: options.shell.editor,
      isReferenced: (assetId) => this.#document.holdsAsset(assetId),
      subscribeDocumentChange: (listener) =>
        this.#document.subscribeDocumentChange(listener),
      onChanged: () => this.#declarationsChanged(),
      onFindAssets: () => options.onFindAssets?.(),
      onFontCommit: (input) => this.#commitFont(input),
      onImportVideo: (file, isPackage, onStep) =>
        this.importPickedVideo(file, { package: isPackage, onStep }),
      onBackground: (asset) => {
        const background = this.#document.envelope.background;
        this.#document.setBackground({
          ...background,
          media: {
            assetId: asset.id,
            bounds: background?.media?.bounds ?? "theme",
          },
        });
        this.#document.refreshBackgroundMedia();
      },
    });
    this.#announceAssetCount();
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
      descriptors,
      artboardHeight: () => options.shell.editor.artboard().height,
    });
    // A pasted image must be a declared asset, not a blob URL: the half-only
    // path saves a document whose image is a handle into this session's memory
    // and is gone from every other tab, every other browser and every reload —
    // silently, because the save succeeds.
    options.shell.editor.clipboardManager.setImageImporter(async (file) => {
      const placed = await this.#assets.placeImage(options.shell.editor, file);
      this.#declarationsChanged();
      return placed;
    });
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
   * One Wallpaper Engine video's import: the host's payload bytes, through the
   * normalizer, then the shared declaration. A scene is converted, not imported;
   * `library.ts` never classifies an image or a web wallpaper, so a video is the
   * only item this can receive.
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
    // authority.
    const normalized = await normalizeWallpaperVideo(file);
    if (!normalized.ok) return { ok: false, message: normalized.message };

    const attribution = item.attribution;
    const steamId = attribution?.steamId;
    // The persona name is the import's only outbound lookup. It runs only when
    // the item names an author, and its failure is absence, never a failed
    // import.
    const authorName =
      steamId === undefined ? undefined : await fetchAuthorName(steamId);
    const sourceUrl =
      attribution?.workshopUrl ??
      (steamId === undefined
        ? undefined
        : `https://steamcommunity.com/profiles/${encodeURIComponent(steamId)}`);

    return this.#declareVideo(normalized.file, {
      credit: {
        ...creditsEntryOf(item, authorName),
        changes: normalized.reencoded
          ? "Re-encoded to the publish envelope"
          : "Copied unchanged",
      },
      metadata: {
        license: { name: "unknown" },
        ...(sourceUrl === undefined ? {} : { sourceUrl }),
      },
    });
  }

  /**
   * One picked `.mpkg` or video: the host prepares the bytes, then the same
   * declaration every video import makes.
   *
   * A package is extracted and normalized in the host's single call, so no
   * second normalize request is made; its title is the credit's. A video file
   * is normalized alone and carries no attribution — the file has none.
   */
  async importPickedVideo(
    file: File,
    options: {
      readonly package: boolean;
      readonly onStep?: (step: VideoImportStep) => void;
    },
  ): Promise<ImportOutcome> {
    options.onStep?.("preparing");
    let prepared: File;
    let credit: ThemeCreditsEntry | undefined;
    let metadata: AssetImportMetadata | undefined;

    if (options.package) {
      const answer = await prepareMobilePackage(file);
      if (!answer.ok) return { ok: false, message: answer.message };
      prepared = answer.file;
      credit = {
        kind: "wallpaper",
        title: answer.title ?? mp4NameOf(file.name),
        license: "unknown",
        changes: answer.reencoded
          ? "Re-encoded to the publish envelope"
          : "Copied unchanged",
      };
      // A package carries no workshop id and no author, so its declaration
      // records the licence it cannot know and no source.
      metadata = { license: { name: "unknown" } };
    } else {
      const normalized = await requestNormalizedVideo(file);
      if (!normalized.ok) return { ok: false, message: normalized.message };
      prepared = new File(
        [normalized.bytes as unknown as BlobPart],
        mp4NameOf(file.name),
        { type: "video/mp4" },
      );
    }

    options.onStep?.("importing");
    const outcome = await this.#declareVideo(prepared, {
      ...(credit === undefined ? {} : { credit }),
      ...(metadata === undefined ? {} : { metadata }),
    });
    return outcome.ok ? { ok: true } : outcome;
  }

  /**
   * The one video transaction: the manager's caps and reference model, the
   * credit when the import has one, and the background consequence every video
   * import makes. The credit is written first, the same order `importAsset`
   * uses — an import that places nothing still carries its attribution.
   */
  async #declareVideo(
    file: File,
    options: {
      readonly credit?: ThemeCreditsEntry;
      readonly metadata?: AssetImportMetadata;
    },
  ): Promise<ImportOutcome> {
    const credit = options.credit;
    if (credit !== undefined && !this.#document.canAddCredit(credit)) {
      return { ok: false, message: uiCopy.assets.creditsFull };
    }

    try {
      const reference = await this.#assets.import(file, options.metadata);
      if (credit !== undefined) this.#document.addCredit(credit);
      const background = this.#document.envelope.background;
      this.#document.setBackground({
        ...background,
        media: {
          assetId: reference.id,
          bounds: background?.media?.bounds ?? "theme",
        },
      });
      this.#declarationsChanged();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * The one font commit the Assets pane reports: a fresh file or a declared
   * face, with or without the preset.
   *
   * The cap is checked before anything is declared, because nothing removes a
   * credit and the package writer refuses an over-cap list at the next save.
   * A fresh file has no id until it is declared (and `import` never dedupes),
   * so its question is the list's length, asked directly: `canAddCredit`'s
   * duplicate-key arm would let a legacy pre-assetId credit of the same title
   * mask a full list. A declared face's real id lets `canAddCredit` answer,
   * because re-creating that face's preset replaces its own credit rather than
   * growing the list. Cancel declares the file and writes neither the preset
   * nor the credit.
   */
  async #commitFont(
    input: FontCommitInput,
  ): Promise<
    | { readonly ok: true; readonly message: string; readonly tokenId?: string }
    | { readonly ok: false; readonly message: string }
  > {
    const { source, metadata, role, withPreset } = input;
    if (!withPreset) {
      try {
        if (!("file" in source))
          throw new Error("A declared font has nothing to import.");
        await this.#assets.importFont(source.file, metadata);
        this.#declarationsChanged();
        return { ok: true, message: uiCopy.panels.assetDeclaredFont };
      } catch (error) {
        return { ok: false, message: messageOf(error) };
      }
    }

    const credit: ThemeCreditsEntry = {
      kind: "font",
      title: metadata.family,
      license: metadata.licence,
      changes: "Imported unchanged",
      ...(metadata.sourceUrl === undefined
        ? {}
        : { source: { url: metadata.sourceUrl } }),
      ...("assetId" in source ? { assetId: source.assetId } : {}),
    };
    const full =
      "file" in source
        ? this.#document.credits().length >= MAX_CREDITS_ENTRIES
        : !this.#document.canAddCredit(credit);
    if (full) return { ok: false, message: uiCopy.assets.creditsFull };

    try {
      const asset =
        "file" in source
          ? await this.#assets.importFont(source.file, metadata)
          : this.#assets.amendFont(source.assetId, metadata);
      const tokenId = this.#document.addTypeTokenFromLocalFont(asset, role);
      this.#document.addCredit({ ...credit, assetId: asset.id });
      this.#declarationsChanged();
      // Only a fresh import is an import; amending a declared face writes the
      // preset, which the Tokens pane shows.
      return {
        ok: true,
        message: "file" in source ? uiCopy.panels.assetDeclaredFont : "",
        // The token this commit created or adopted, so a caller that asked for
        // the import can point its own reference at it.
        tokenId,
      };
    } catch (error) {
      return { ok: false, message: messageOf(error) };
    }
  }

  /**
   * The import row: the OS picker, then the metadata dialog.
   *
   * A dismissed picker declares nothing, and the input is removed either way so
   * a second press starts from an empty pick. `onImported` is the run row's:
   * the dialog names the token its commit produced, and that caller acts on it.
   */
  #pickFontFile(onImported?: (tokenId: string) => void): void {
    const input = document.createElement("input");
    input.type = "file";
    input.hidden = true;
    input.accept = FONT_FILE_ACCEPT;
    input.dataset["yunariTokenFontImport"] = "";
    const dispose = (): void => input.remove();
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      dispose();
      if (file !== undefined) this.#openFontImport(file, onImported);
    });
    // Fired by a browser that reports a cancelled picker; without it the input
    // would stay on the body until the next pick.
    input.addEventListener("cancel", dispose);
    document.body.append(input);
    input.click();
  }

  /**
   * The dialog answers with the same two commits the Assets pane makes, minus
   * the role: this import may never rewrite a role token.
   */
  #openFontImport(file: File, onImported?: (tokenId: string) => void): void {
    void openFontImportDialog({
      filename: file.name,
      initial: fontMetadataFromFilename(file.name),
      onCommit: (metadata) =>
        this.#commitFont({
          source: { file },
          metadata,
          role: null,
          withPreset: true,
        }),
      onCancel: (metadata) =>
        this.#commitFont({
          source: { file },
          metadata,
          role: null,
          withPreset: false,
        }),
      ...(onImported === undefined ? {} : { onCommitted: onImported }),
    });
  }

  /**
   * The declarations moved: the Assets pane's title count, the background
   * column's picture list and the bytes the artboard resolves all read them, so
   * one method serves every path that adds or drops one.
   */
  #declarationsChanged(): void {
    this.#selection.render();
    this.#document.refreshBackgroundMedia();
    this.#announceAssetCount();
  }

  /** The initial count, before anything has moved. */
  #announceAssetCount(): void {
    this.#options.onAssetCountChange?.(this.#assets.declarations.length);
  }

  /**
   * The one route every surface arms: the Add pane's text tile, the canvas
   * context menu and the layer footer all reach this method, so the editor has
   * one placement state rather than one per surface.
   *
   * Arming cannot fail — the theme's palette and type preset are read when the
   * gesture ends — so the construction is the only part wrapped. A refusal is
   * reported there once, and the gesture has already disarmed by then.
   */
  #armText(): void {
    const editor = this.#options.shell.editor;
    editor.textManager.beginPlacement({
      contained: ({ x, y }) => {
        // Scene coordinates, origin (0,0): the artboard's frame is the limit,
        // and a press outside it cancels without creating anything.
        const artboard = editor.artboard();
        return x >= 0 && x <= artboard.width && y >= 0 && y <= artboard.height;
      },
      onPlace: (placement) =>
        constructing(editor, () =>
          insertNewText(editor, this.#document.envelope.globals, placement),
        ),
    });
  }

  /**
   * The finder's Fonts body with the preview panel's actions wired. Every
   * action is the document's write; the panel only reports a press. Apply to
   * selected token travels only when a store names a type token, because the
   * panel draws that button on the callback's presence (R9). The inspector's
   * token wins, else the shell's canvas projection; a paint is not a type
   * target. Read when the body is built and closed over until the next build:
   * safe because the finder is modal and nothing can move either store while
   * it is open — a non-modal finder would need the read moved into the action.
   */
  #fontPickerBody(): ReactElement {
    const document = this.#document;
    const presets = document.envelope.globals?.typeTokens as
      | TypeTokens
      | undefined;
    const token = this.#options.tokenSelection?.get();
    const selected =
      token?.kind === "preset"
        ? token.id
        : this.#options.selection?.get().selectionPresetId;
    const run = (action: () => Promise<unknown>): void => {
      void document.runFontAction(async () => {
        await action();
        // An adopted face is a declaration, so the Assets count and the
        // background column re-resolve as they do after an import.
        this.#declarationsChanged();
      });
    };
    return createElement(FontsBody, {
      ...(presets === undefined ? {} : { presets }),
      onApplyTrio: (trio) => {
        run(() => document.applyFontTrio(trio));
      },
      onAddTrioPresets: (trio) => {
        run(() => document.addTypeTokensFromTrio(trio));
      },
      onAddPreset: (cut, role, family) => {
        run(() => document.addTypeTokenFromCut(cut, role, family));
      },
      ...(selected === undefined
        ? {}
        : {
            onApplyToSelected: (cut: FontCut, family: readonly FontCut[]) => {
              run(() => document.applyCutToPreset(selected, cut, family));
            },
          }),
    });
  }

  /** Reachability only: the shell menus dispatch through the existing owners,
   *  including the private document actions the panel section used to call. */
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
      // The finder's Fonts body, wired to the document's writes. The panel is
      // presentational: every refusal reaches the author through
      // `runFontAction`, and the selection-to-preset projection is the shell's.
      fontPickerBody: () => this.#fontPickerBody(),
      // The finder's Wallpaper Engine body. The listing is the body's own fetch
      // — it is a library, not a search — so the session owns only the writes a
      // card triggers: a video's background, a scene's local project, and a
      // picked `.mpkg` through the same one-call import the Assets pane uses.
      wallpaperEngineBody: () =>
        createElement(WallpaperEngineBody, {
          onSetBackground: (item) => this.importWallpaperItem(item),
          onConvert: (item) => startProject(item.workshopId),
          onImportPackage: (file, onStep) =>
            this.importPickedVideo(file, { package: true, onStep }),
        }),
      // One finder row's action. The bytes come from the host, the manager
      // keeps its caps and sanitising, and the credit is written before the
      // asset's own consequence runs — an import that places nothing still
      // carries its attribution.
      importAsset: async (page, result, placement) => {
        // A preset is editor-local data, not an asset: no bytes, no credit.
        const preset = result.preset;
        if (preset !== undefined) return applyPreset({ ...result, preset });

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
            // An image lands in the theme's background unless the author asked
            // for the canvas, which is the second press the finder offers.
            if (result.kind === "image" && placement !== "place") {
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
          // A finder import makes a declaration just as the Assets pane's own
          // file does, so the pane's title and the background column re-resolve.
          this.#declarationsChanged();
        }
        return outcome.ok
          ? { ok: true as const }
          : { ok: false as const, message: outcome.message };
      },
      openLibraryTheme: (id, onAccepted) =>
        this.#document.openLibraryTheme(id, onAccepted),
      saveLibrary: () => this.#document.saveLibrary(),
      // The constructions the shell dispatches are wrapped in the one owner of
      // a construction's refusal (`new-object-panel.ts`), because the surfaces
      // that reach them — the layer footer through `bridge.run`, and the canvas
      // context menu through `creationGroups` — both hold a `void` and cannot
      // report a throw themselves (`vg-484`). `addText` arms rather than
      // constructs now, so its refusal is reported at the gesture's end by
      // `#armText`. `insertCard` is not wrapped: the document reports that one
      // at its own owner.
      addText: () => this.#armText(),
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

  async hydrateAssets(shell: EditorShell): Promise<void> {
    await this.#assets.hydrate(shell.editor.canvas);
  }

  async applyFontTrio(id: string): Promise<FabricThemeEnvelope> {
    const envelope = await this.#document.applyFontTrio(id);
    // The trio adopted three declarations, so the Assets pane's count moves
    // here as it does for an import.
    this.#declarationsChanged();
    return envelope;
  }

  async applyPresetFace(
    id: string,
    face: CuratedFontFace,
  ): Promise<FabricThemeEnvelope> {
    const envelope = await this.#document.applyPresetFace(id, face);
    this.#declarationsChanged();
    return envelope;
  }

  /**
   * Whether the document still declares the token a ref names.
   *
   * Read at render time rather than tracked: the document is the one owner of
   * its globals, and an undo, a load or a panel write can drop an entry without
   * either delete route running.
   */
  #tokenExists(token: TokenRef): boolean {
    if (token.kind === "preset") {
      const presets = (this.#document.envelope.globals?.typeTokens ??
        {}) as TypeTokens;
      return presets[token.id] !== undefined;
    }
    return this.#document.envelope.globals?.palette?.[token.id] !== undefined;
  }

  /**
   * The one type-preset delete route, handed to both the preset library and the
   * token inspector.
   *
   * The document re-points the references; a token selection still naming the
   * deleted preset is cleared here, so the object column comes back rather than
   * the right column staying suppressed over a token that no longer exists.
   */
  #deleteType(id: string, replacement: string): void {
    this.#document.deleteType(id, replacement);
    const selection = this.#options.tokenSelection;
    const token = selection?.get();
    if (token?.kind === "preset" && token.id === id) selection?.clear();
  }

  /**
   * The one paint-token delete route, handed to the palette pane and the token
   * inspector.
   *
   * The document re-points the references; a token selection still naming the
   * deleted paint is cleared here, so the object column comes back rather than
   * the right column staying suppressed over a token that no longer exists.
   */
  #deletePalette(id: string, replacement: string): void {
    this.#document.deletePalette(id, replacement);
    const selection = this.#options.tokenSelection;
    const token = selection?.get();
    if (token?.kind === "paint" && token.id === id) selection?.clear();
  }

  destroy(): void {
    this.#unsubscribeSelection?.();
    this.#unsubscribeTokenSelection?.();
    this.#unsubscribeTokenDocument?.();
    this.#shortcuts.destroy();
    this.#nudge.dispose();
    this.#document.destroy();
    this.#assets.destroy();
    this.charts.destroy();
    this.#selection.root.remove();
    this.#tokenInspector.destroy();
    this.#artboard.destroy();
    this.#palette.destroy();
    this.#types.destroy();
    this.#newObjects.destroy();
    this.#assetsPanel.destroy();
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

/** One video item, through the host's envelope. */
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

/** A refusal's own words, or the value itself when it was not an `Error`. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The package's declared font families, one entry per family, sorted the way a
 * reader scans a list rather than the order the files arrived in. A family
 * differing only in case is the same family, so the first spelling is kept.
 */
function declaredFamilies(
  declarations: AssetManager["declarations"],
): readonly string[] {
  const held = new Map<string, string>();
  for (const asset of declarations) {
    if (asset.kind !== "font" || !("family" in asset)) continue;
    const key = asset.family.toLowerCase();
    if (!held.has(key)) held.set(key, asset.family);
  }
  return [...held.values()].sort((left, right) =>
    left.localeCompare(right, "en", { sensitivity: "base" }),
  );
}
