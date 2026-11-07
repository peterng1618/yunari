import {
  type FabricThemeEnvelope,
  type FabricThemeEnvelopeInput,
  type SampleSource,
  SEMANTIC_KEYS,
  type SemanticKeyDescriptor,
} from "@yunari/renderer-core";
import { sceneBoxesOf } from "@yunari/scene-fabric";
import type { VideoTrimRange } from "@yunari/theme-package";
import { type ArtboardPanel, createArtboardPanel } from "./artboard-panel.js";
import type { ImportOutcome } from "./asset-finder/actions.js";
import type { AssetManager } from "./asset-manager/index.js";
import { type CanvasNudge } from "./canvas-nudge.js";
import { ChartManager } from "./chart-manager/index.js";
import { createClipboardAssets } from "./clipboard-manager/asset-port.js";
import { EditorDocument } from "./editor-document.js";
import {
  type ActionFacadeHost,
  buildActionFacade,
} from "./editor-session-actions.js";
import {
  commitFont,
  declaredFamilies,
  type FontCommitHost,
  pickFontFile,
} from "./editor-session-fonts.js";
import type { EditorSessionOptions } from "./editor-session-options.js";
import { registerSessionShortcuts } from "./editor-session-shortcuts.js";
import {
  addPaintToken,
  addTypeToken,
  deletePalette,
  deleteType,
  tokenExists,
} from "./editor-session-tokens.js";
import {
  importPickedVideo,
  importWallpaperItem,
  type PickedVideoOptions,
  type VideoImportHost,
} from "./editor-session-video.js";
import type { EditorActionFacade } from "./editor-shell/session-facade.js";
import { type EditorShell } from "./editor-shell.js";
import { type CuratedFontFace } from "./font-catalog.js";
import {
  createIndicatorManager,
  type IndicatorManager,
} from "./indicator-manager/index.js";
import { IndicatorStore } from "./indicator-manager/store.js";
import { LiveRuntime } from "./live-runtime.js";
import {
  constructing,
  createNewObjectPanel,
  insertNewText,
  type NewObjectPanel,
} from "./new-object-panel.js";
import {
  createPalettePanel,
  type PalettePanel,
  paletteTokenUsage,
} from "./palette-manager/index.js";
import { createAssetsPane } from "./panes/assets/assets-pane.js";
import {
  createTokenInspectorPanel,
  type TokenInspectorActions,
  type TokenInspectorPanel,
} from "./panes/tokens/token-inspector.js";
import type { TokenUse } from "./panes/tokens/token-use.js";
import { weightChoices } from "./panes/tokens/weight-choices.js";
import type { DesignTokenPort } from "./selection-inspector/design-token-editor.js";
import {
  createSelectionInspector,
  type SelectionInspector,
} from "./selection-inspector/index.js";
import { createMentionPort } from "./selection-inspector/mention-port.js";
import { ShortcutManager } from "./shortcut-manager/index.js";
import { createSnapManager, type SnapManager } from "./snap-manager/index.js";
import {
  createTypeTokenPanel,
  type TypeTokenFontActions,
  type TypeTokenPanel,
  type TypeTokens,
  typeTokenUsage,
} from "./type-preset-manager/index.js";
import type { WallpaperEngineItem } from "./wallpaper-engine/client.js";

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

    // The header toolbar dispatches these through `actionFacade`.
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
      // The shell's store when there is a shell to draw the readings; a
      // session with no chrome keeps a private one so the handlers stay total.
      store: options.indicators ?? new IndicatorStore(),
    });
    this.#artboard = createArtboardPanel(
      options.panelHosts.document,
      (artboard) => this.#document.setArtboard(artboard),
      {
        onMetadataChange: (metadata) => this.#document.setMetadata(metadata),
        // The conversion is the document's: it scales the scene, writes the
        // board and records the one history entry.
        onShapeChange: (shape) => this.#document.setArtboardShape(shape),
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
      this.#document.credits(),
    );
    // The one walk behind both the figure beside a token and the users list in
    // the inspector, so the two cannot disagree about the scene.
    const paletteUsage = (): Readonly<Record<string, readonly TokenUse[]>> =>
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
    // are the same owner answering the same question, so neither
    // re-implements a face or trio write.
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
    // The same one walk for type tokens: the figure beside a row and the users
    // list in the inspector read it, and the delete's reassignment walk is the
    // write half of the same traversal.
    const typeUsage = (): Readonly<Record<string, readonly TokenUse[]>> =>
      typeTokenUsage(
        options.shell.editor.canvas,
        this.#document.envelope.globals?.typeTokens ?? {},
      );
    this.#types = createTypeTokenPanel(
      options.panelHosts.tokens,
      (presets) => this.#document.setTypes(presets),
      (id, replacement) =>
        deleteType(
          this.#document,
          this.#options.tokenSelection,
          id,
          replacement,
        ),
      fontActions,
      // The token a row press selects, which the inspector will read.
      options.tokenSelection,
      typeUsage,
    );
    this.#types.render(
      this.#document.envelope.globals?.typeTokens as TypeTokens | undefined,
    );
    // The chart owner, built before the inspector that renders its fields: the
    // inspector is published with both halves of the port at construction, so
    // the owner has to exist by then.
    const descriptors = (): readonly SemanticKeyDescriptor[] =>
      options.sensors?.descriptors() ?? SEMANTIC_KEYS;
    const measured = (): ReadonlySet<string> | undefined =>
      options.sensors?.measured();
    // Every reading the theme binds. A key on this set that the host does not
    // answer is what the reading list marks "bound but unavailable".
    const bound = (): ReadonlySet<string> => this.#document.boundKeys();
    this.charts = new ChartManager({
      editor: options.shell.editor,
      scene: options.shell.scene,
      source: options.source,
      descriptors,
      ...(this.#document.envelope.bindings === undefined
        ? {}
        : { bindings: this.#document.envelope.bindings }),
      ...(this.#document.envelope.globals === undefined
        ? {}
        : { globals: this.#document.envelope.globals }),
      onBindingsChange: (id, bindings) =>
        this.#document.setBindings(id, bindings),
    });
    // The selected token's own properties, in the same host as the object
    // column — exactly one of the two draws. The session owns both halves: the
    // document's writes (which reach history through `setTypes`) and the
    // suppression the token selection drives. A new surface built in
    // `shell-layout` would need a second copy of the document.
    //
    // Built before the selection inspector so the run rows' in-place editor can
    // be handed the same actions: one write route whichever surface asked.
    const tokenActions: TokenInspectorActions = {
      onChange: (presets) => this.#document.setTypes(presets),
      // The same port the preset library is handed: one delete route, so the
      // reference reassignment and the token clear cannot disagree.
      onDelete: (id, replacement) =>
        deleteType(
          this.#document,
          this.#options.tokenSelection,
          id,
          replacement,
        ),
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
      importLocalFont: () => pickFontFile(this.#fontHost()),
      ...(options.onFindFontPicker === undefined
        ? {}
        : { openFontFinder: options.onFindFontPicker }),
      // The paint half: the selected paint token's fields write through the
      // same document and history ports as the pane's rows once did.
      paints: {
        palette: () => this.#document.envelope.globals?.palette ?? {},
        onChange: (palette) => this.#document.setPalette(palette),
        onSettled: () => options.shell.editor.historyManager.saveState(),
        onDelete: (id, replacement) =>
          deletePalette(
            this.#document,
            this.#options.tokenSelection,
            id,
            replacement,
          ),
        background: () => this.#document.envelope.background,
        usage: paletteUsage,
      },
      // The type half: the same one walk, so the users list under the preset
      // fields agrees with the figure beside the pane's row.
      typeUsage,
      ...(options.onRevealLayer === undefined
        ? {}
        : { onRevealLayer: options.onRevealLayer }),
    };
    const designTokens: DesignTokenPort = {
      actions: tokenActions,
      // Getters, not copies: the document is the one owner of its globals, so
      // a snapshot taken here would show a token the first write replaced.
      typeTokens: () =>
        (this.#document.envelope.globals?.typeTokens ?? {}) as TypeTokens,
      palette: () => this.#document.envelope.globals?.palette ?? {},
      create: (kind) => {
        if (kind === "paint") {
          const added = addPaintToken(
            this.#document.envelope.globals?.palette ?? {},
          );
          this.#document.setPalette(added.palette);
          // `setPalette` is the live write; adding a token is a discrete edit,
          // so the entry is settled here as the pane's add settles it.
          options.shell.editor.historyManager.saveState();
          return { kind: "paint", id: added.id };
        }
        const added = addTypeToken(
          (this.#document.envelope.globals?.typeTokens ?? {}) as TypeTokens,
        );
        // `setTypes` settles history itself.
        if (added.created) this.#document.setTypes(added.presets);
        return { kind: "preset", id: added.id };
      },
      reveal: (ref) => {
        // Show the pane first, then select: the token inspector is the pane's
        // own surface, and selecting the token is what the store owns.
        options.onShowTokens?.();
        options.tokenSelection?.set(ref);
      },
    };
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
      // Which of those readings this PC answers now; `undefined` until the host
      // says, and then the picker leaves every key offered as it does today.
      measured,
      bound,
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
      // Which asset is shown and which model is in force are the document's
      // switches, not whole-background replacements: only the document can
      // capture the outgoing asset's geometry and restore the incoming one's.
      onBackgroundAssetSelect: (assetId) =>
        this.#document.setBackgroundAsset(assetId),
      onBackgroundModeChange: (mode) => this.#document.setBackgroundMode(mode),
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
      importLocalFont: (onImported) =>
        pickFontFile(this.#fontHost(), onImported),
      // The run rows' in-place token editor: the same actions and the same
      // selection store the Tokens pane uses.
      designTokens,
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
    // `shell-layout` would need a second copy of the document. The actions are
    // the same object the run rows' editor was handed above.
    this.#tokenInspector = createTokenInspectorPanel(
      options.panelHosts.selection,
      tokenActions,
    );
    const renderTokenInspector = (): void => {
      const held = options.tokenSelection?.get();
      // A token the document no longer declares keeps the object column
      // suppressed over a blank section — the shape an undo of Add leaves, not
      // only the delete routes. Dropping the ref here re-enters through the
      // store's subscription with no token and gives the column back.
      if (held !== undefined && !tokenExists(this.#document, held)) {
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
    // An inline `@` names a reading. The run write is the document's, because
    // it owns the node's bindings, and the readings offered are the catalogue's.
    options.shell.editor.textManager.setMentions(
      createMentionPort(this.#document, descriptors, measured),
    );
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
      isReferenced: (assetId) => this.#document.isAssetReferenced(assetId),
      subscribeDocumentChange: (listener) =>
        this.#document.subscribeDocumentChange(listener),
      onChanged: () => this.#declarationsChanged(),
      // A removed declaration's credit goes with it: the package must not
      // credit a file the theme no longer holds. The manager's Remove is not
      // the document's prune, so the document is told here.
      onRemoved: (assetId) => this.#document.removeCreditForAsset(assetId),
      onFindAssets: () => options.onFindAssets?.(),
      // The preview reads the package's credit for the asset it shows, so an
      // author and a licence the declaration never carries still surface.
      creditFor: (assetId) => this.#document.creditForAsset(assetId),
      onFontCommit: (input) => commitFont(this.#fontHost(), input),
      sizeSummary: () => this.#document.sizeSummary(),
      onImportVideo: (file, isPackage, onStep, trim) =>
        this.importPickedVideo(file, {
          package: isPackage,
          onStep,
          ...(trim === undefined ? {} : { trim }),
        }),
      onBackground: (asset) => {
        this.#document.setBackgroundAsset(asset.id);
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
    // A copy that leaves this theme carries the declared bytes it references.
    // The destination declares them under fresh ids before the paste re-points
    // the object, so a cross-theme paste never names files the theme lacks.
    options.shell.editor.clipboardManager.setAssets(
      createClipboardAssets(this.#assets, () => this.#declarationsChanged(), {
        readCredit: (assetId) => this.#document.creditForAsset(assetId),
        addCredit: (entry) => this.#document.addCredit(entry),
      }),
    );
    this.#document.refreshBackgroundMedia();
    // The dispatcher's chords are one owner: every one reaches the control it
    // is printed beside rather than a second implementation of the command.
    this.#nudge = registerSessionShortcuts({
      shortcuts: this.#shortcuts,
      options,
      document: this.#document,
    });
  }

  get envelope(): FabricThemeEnvelopeInput {
    return this.#document.envelope;
  }

  /** The document as the author last left it: what a save ships, and what the
   *  draft holds. Read here rather than composed at the caller, so
   *  the authored-JSON merge the snapshot is stays the document's — a second
   *  one at the boot path would drop the asset declarations with it. */
  snapshot(): FabricThemeEnvelope {
    return this.#document.snapshot();
  }

  /** One Wallpaper Engine video: the video owner writes the declaration and
   *  the background; the session only names the owners it writes through. */
  importWallpaperItem(
    item: WallpaperEngineItem,
    trim?: VideoTrimRange,
  ): Promise<ImportOutcome> {
    return importWallpaperItem(this.#videoHost(), item, trim);
  }

  /** One picked `.mpkg` or video: the same one-call import the Assets pane
   *  reports, through the video owner. */
  importPickedVideo(
    file: File,
    options: PickedVideoOptions,
  ): Promise<ImportOutcome> {
    return importPickedVideo(this.#videoHost(), file, options);
  }

  /** The ports the video and font owners write through. */
  #videoHost(): VideoImportHost {
    return {
      assets: this.#assets,
      document: this.#document,
      declarationsChanged: () => this.#declarationsChanged(),
    };
  }

  #fontHost(): FontCommitHost {
    return {
      assets: this.#assets,
      document: this.#document,
      declarationsChanged: () => this.#declarationsChanged(),
    };
  }

  /**
   * The declarations moved: the Assets pane's heading count, the background
   * column's picture list and the bytes the artboard resolves all read them, so
   * one method serves every path that adds or drops one.
   */
  #declarationsChanged(): void {
    this.#selection.render();
    this.#document.refreshBackgroundMedia();
    this.#announceAssetCount();
    // An import adds or replaces a credit, and a removed asset prunes one, so
    // the Document pane's attribution is redrawn by the same signal that moves
    // the asset count rather than by a second subscription.
    this.#artboard.render(
      this.#document.envelope.artboard,
      this.#document.envelope.metadata,
      this.#document.credits(),
    );
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

  /** Reachability only: the shell menus dispatch through the existing owners,
   *  including the private document actions the panel section used to call. */
  actionFacade(): EditorActionFacade {
    const host: ActionFacadeHost = {
      options: this.#options,
      document: this.#document,
      assets: this.#assets,
      charts: this.charts,
      video: this.#videoHost(),
      declarationsChanged: () => this.#declarationsChanged(),
      armText: () => this.#armText(),
    };
    return buildActionFacade(host);
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
   * The readings the pickers offer moved. The column pulls `descriptors` at
   * render time, so a projection after the catalogue answers is all a mounted
   * picker needs to offer a key the host has just learned.
   */
  catalogueChanged(): void {
    this.#selection.render();
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
