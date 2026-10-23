import {
  type Artboard,
  type Background,
  type Binding,
  bumpSemanticVersion,
  type FabricPalette,
  type FabricThemeEnvelope,
  type FabricThemeEnvelopeInput,
} from "@yunari/renderer-core";
import {
  MAX_CREDITS_ENTRIES,
  type ThemeCredits,
  type ThemeCreditsEntry,
} from "@yunari/theme-package";
import type { ArtboardPanel } from "./artboard-panel.js";
import type { AssetManager } from "./asset-manager/index.js";
import { insertCard } from "./card-library.js";
import type { ChartManager } from "./chart-manager/index.js";
import type { EditorShell } from "./editor-shell.js";
import {
  applyFontTrio,
  type CuratedFontFace,
  fontTrio,
} from "./font-catalog.js";
import type { LiveRuntime } from "./live-runtime.js";
import {
  chooseArtboardSize,
  type NewDocumentAnswer,
} from "./new-document-chooser.js";
import type { NewObjectPanel } from "./new-object-panel.js";
import {
  type PalettePanel,
  reassignPaletteToken,
} from "./palette-manager/index.js";
import { serializeThemePackage } from "./persist.js";
import {
  confirmDocumentReplacement,
  PersistenceManager,
} from "./persistence-manager/index.js";
import type { SelectionInspector } from "./selection-inspector/index.js";
import type { ThemeLibraryClient } from "./theme-library-client.js";
import { ThemeLibraryManager } from "./theme-library-manager/index.js";
import { captureThumbnail } from "./thumbnail-capture.js";
import {
  reassignTypePresetToken,
  type TypePresetPanel,
  type TypePresets,
} from "./type-preset-manager/index.js";

/**
 * What the document needs of whoever is editing it, which is the session's own
 * options object.
 *
 * Structural rather than imported, so the session keeps naming its options and
 * this owner reads only the fields a document has a use for.
 */
interface EditorDocumentSource {
  readonly shell: EditorShell;
  readonly envelope: FabricThemeEnvelopeInput;
  readonly assetManager: AssetManager;
  /** The picture the opened package carried, if it carried one. A save that
   *  cannot render one of its own keeps this rather than losing it. */
  readonly thumbnail?: Uint8Array;
  /** The package's attribution member, when the document arrived from one:
   *  the collection every later import is added to. */
  readonly credits?: readonly ThemeCreditsEntry[];
  readonly libraryClient?: ThemeLibraryClient;
  /** The stored document this one was opened from, when it was opened from
   *  the library. Every save made from here is checked against it. */
  readonly libraryBase?: string;
  /** Nothing is saved behind this document — a draft restored after a crash —
   *  so it has no state to compare against and reads as unsaved until a save
   *  gives it one. */
  readonly unsaved?: boolean;
  /** Creates a blank document at the artboard the author chose. The chooser
   *  itself is the session's, so the size is asked before the open document is
   *  even offered up for replacement. */
  readonly onNew: (answer: NewDocumentAnswer) => Promise<void>;
  /** Creates a document from the reference composition, as a template. */
  readonly onNewFromStarter: () => Promise<void>;
  readonly onSaved: (message?: string) => void;
  readonly onError?: (message: string) => void;
  readonly onBindingsChange?: () => void;
  readonly onOpenTheme?: (
    envelope: FabricThemeEnvelope,
    assets: Readonly<Record<string, Uint8Array>>,
    base?: string,
  ) => Promise<void>;
}

/**
 * Every owner that renders part of this document, asked for at the moment a
 * write fans out.
 *
 * Asked for rather than held because the order is the other way round: a panel
 * reads the document's envelope while it mounts, so the document is composed
 * before the owners it fans out to, and these are the ports that reach forward
 * to them.
 */
interface EditorDocumentConsumers {
  readonly runtime: () => LiveRuntime;
  readonly charts: () => ChartManager;
  readonly newObjects: () => NewObjectPanel;
  readonly artboard: () => ArtboardPanel;
  readonly palette: () => PalettePanel;
  readonly types: () => TypePresetPanel;
  readonly selection: () => SelectionInspector;
}

interface EditorDocumentOptions {
  readonly source: EditorDocumentSource;
  readonly consumers: EditorDocumentConsumers;
}

/** A credit's identity: the item, and where it came from. */
function creditKey(entry: ThemeCreditsEntry): string {
  return `${entry.source?.url ?? ""}\n${entry.title}`;
}

/**
 * The theme this editor is authoring: what it says now, every write that
 * changes it, and the file protocol that opens, saves and releases it.
 *
 * It is an owner because the envelope has exactly one writer. A theme's fields
 * are read by the shell, by every panel and by the save path, and a second
 * place that mutated the envelope would be a second document — the failure
 * being one setter missing the fan-out or the unsaved marker, which nothing
 * else would notice. The session above composes this document from the shell;
 * it does not hold it.
 */
export class EditorDocument {
  #envelope: FabricThemeEnvelopeInput;
  /** The picture this document arrived with, which a save falls back to. */
  #thumbnail: Uint8Array | undefined;
  /** Every imported asset's attribution, written into the package's
   *  `credits.json` at save. Seeded from the package this document opened. */
  readonly #credits: ThemeCreditsEntry[];
  readonly #source: EditorDocumentSource;
  readonly #shell: EditorShell;
  readonly #assets: AssetManager;
  readonly #persistence: PersistenceManager;
  readonly #consumers: EditorDocumentConsumers;
  /** The host's library, which owns this document's stored base. */
  readonly #library: ThemeLibraryManager;
  readonly #onBindingsChange: (() => void) | undefined;
  /** Told the document may have moved; see `#writeEnvelope`. */
  readonly #documentChangeListeners = new Set<() => void>();
  /** A stable reference, so whoever registers it can keep it without binding:
   *  the library manager takes it as a port and the session hands it to every
   *  canvas event that means "the document moved". */
  readonly announceChange = (): void => {
    for (const listener of this.#documentChangeListeners) listener();
  };

  constructor(options: EditorDocumentOptions) {
    const source = options.source;
    this.#source = source;
    this.#shell = source.shell;
    this.#envelope = source.envelope;
    this.#thumbnail = source.thumbnail;
    this.#credits = [...(source.credits ?? [])];
    this.#assets = source.assetManager;
    this.#onBindingsChange = source.onBindingsChange;
    this.#consumers = options.consumers;
    // What was last saved, which the unsaved marker is compared against. A
    // restored draft has nothing saved behind it, so there is nothing to
    // compare against: it reads as unsaved until a save gives it a baseline.
    this.#persistence = new PersistenceManager(
      this.snapshot(),
      this.#assets.assets,
      source.unsaved === true ? { unsaved: true } : undefined,
    );
    // The library owns the stored base and the protocol a save against it
    // follows. What it cannot decide — this document, its picture, whether the
    // author has agreed to replace it — arrives as the manager's port.
    this.#library = new ThemeLibraryManager({
      snapshot: () => this.snapshot(),
      assets: this.#assets,
      picture: () => this.picture(),
      markSaved: (theme, assets) => this.#persistence.markSaved(theme, assets),
      announceChange: this.announceChange,
      errors: source.shell.editor.errorManager,
      confirmReplacement: () => this.confirmReplacement(),
      onSaved: source.onSaved,
      onNewFromStarter: source.onNewFromStarter,
      ...(source.libraryBase === undefined ? {} : { base: source.libraryBase }),
      ...(source.libraryClient === undefined
        ? {}
        : { client: source.libraryClient }),
      ...(source.onError === undefined ? {} : { onError: source.onError }),
      ...(source.onOpenTheme === undefined
        ? {}
        : { onOpenTheme: source.onOpenTheme }),
    });
  }

  get envelope(): FabricThemeEnvelopeInput {
    return this.#envelope;
  }

  /** The document as the author last left it, which is what a save ships and
   *  what the unsaved marker is compared against. */
  snapshot(): FabricThemeEnvelope {
    return this.#shell.snapshot({
      ...this.#envelope,
      ...(this.#assets.declarations.length === 0
        ? {}
        : { assets: this.#assets.declarations }),
    });
  }

  /** Whether the document differs from what was last saved. Pulled, never held:
   *  the comparison already exists for the replace prompt, and a stored flag
   *  would be one more thing to keep true. */
  isDirty(): boolean {
    return this.#persistence.isDirty(this.snapshot(), this.#assets.assets);
  }

  /** The attribution the saved package will carry, in arrival order. */
  credits(): readonly ThemeCreditsEntry[] {
    return [...this.#credits];
  }

  /** Whether one more credit can be held: the package writer refuses a list
   *  past its cap, and nothing removes an entry, so the refusal happens before
   *  the bytes are declared rather than at the next save. */
  canAddCredit(entry: ThemeCreditsEntry): boolean {
    return (
      this.#credits.length < MAX_CREDITS_ENTRIES ||
      this.#credits.some((current) => creditKey(current) === creditKey(entry))
    );
  }

  /** One imported asset's attribution. The same source item twice is one
   *  entry, not two: a re-import replaces the credit it already had. */
  addCredit(entry: ThemeCreditsEntry): void {
    const key = creditKey(entry);
    const at = this.#credits.findIndex((current) => creditKey(current) === key);
    if (at === -1) this.#credits.push(entry);
    else this.#credits.splice(at, 1, entry);
    this.announceChange();
  }

  /** The package member, or nothing when there is nothing to attribute. */
  #creditsPackage(): ThemeCredits | undefined {
    return this.#credits.length === 0
      ? undefined
      : {
          format: "yunari-theme-credits",
          version: 1,
          entries: [...this.#credits],
        };
  }

  /** Told "look again", not told the answer: a path that announces without
   *  having changed anything costs a recompute rather than a wrong marker. */
  subscribeDocumentChange(listener: () => void): () => void {
    this.#documentChangeListeners.add(listener);
    return () => {
      this.#documentChangeListeners.delete(listener);
    };
  }

  async save(): Promise<void> {
    const options = this.#source;
    try {
      const current = this.snapshot();
      // The package carries the theme's picture so whoever receives the file
      // can see the look without installing anything.
      await this.#persistence.save(
        current,
        this.#assets.assets,
        await this.picture(),
        this.#creditsPackage(),
      );
      this.announceChange();
      options.onSaved("Theme package saved");
    } catch (error) {
      options.onError?.(error instanceof Error ? error.message : String(error));
    }
  }

  /** The picture a save ships, or the one this document arrived with: a
   *  capture that fails must cost the preview, not the theme. One owner for the
   *  fallback, called by every save that ships a picture — `save` and the
   *  library's `picture` port alike. It was spelled inline at `save` as well,
   *  so two changes to the policy left one of them missing `save` (`vg-239`). */
  async picture(): Promise<Uint8Array | undefined> {
    return (await this.#capture()) ?? this.#thumbnail;
  }

  /** The browser already has the theme on screen, so it is the right place to
   *  render it; a failure here is not a failure of what is being saved. */
  async #capture(): Promise<Uint8Array | undefined> {
    try {
      return await captureThumbnail(
        this.#shell.editor.canvas,
        undefined,
        this.#shell.backdrop(),
        // A package saved from inside an entered group ships the document, not
        // the dim the author is working behind (0053, `vg-527`).
        () => this.#shell.editor.groupingManager.suspendDim(),
      );
    } catch {
      return undefined;
    }
  }

  async newDocument(): Promise<void> {
    // The chooser first, then the replacement question: an author who opens
    // `New` and then thinks better of it must not be asked to confirm
    // discarding their work on the way to deciding they wanted none of it.
    // It opens on the display the artboard being replaced is, so a document
    // already settled on an upright lens is not thrown back to the 16:9 one
    // without being asked.
    //
    // The whole answer travels, not just its size: the display the author
    // picked is what the new document is shown through, and dropping it here
    // is what left a portrait artboard inside a landscape frame.
    const answer = await chooseArtboardSize(this.#envelope.artboard);
    if (answer === undefined) return;
    if (!(await this.confirmReplacement())) return;
    this.#library.forget();
    await this.#source.onNew(answer);
  }

  async newFromStarter(): Promise<void> {
    if (!(await this.confirmReplacement())) return;
    this.#library.forget();
    await this.#source.onNewFromStarter();
  }

  async confirmReplacement(): Promise<boolean> {
    const current = this.snapshot();

    if (this.#persistence.isDirty(current, this.#assets.assets)) {
      const choice = await confirmDocumentReplacement();

      if (choice === "cancel") return false;
      if (choice === "save") {
        await this.#persistence.save(
          current,
          this.#assets.assets,
          undefined,
          this.#creditsPackage(),
        );
        this.#source.onSaved("Theme package saved");
      }
    }
    return true;
  }

  async release(): Promise<void> {
    const options = this.#source;
    const level = window.prompt("Release bump: major, minor or patch", "patch");
    if (level !== "major" && level !== "minor" && level !== "patch") return;
    try {
      // **The one archive left in this file, and it is not a round trip.**
      // Nothing is stored here: the package is built so the release refuses a
      // theme that would not export, and the archive is then downloaded by
      // `save`. The library is a folder (ADR-0017); the export is not.
      const beforeRelease = serializeThemePackage(
        this.snapshot(),
        this.#assets.assets,
        undefined,
        this.#creditsPackage(),
      );
      if (!beforeRelease.ok) throw new Error(beforeRelease.message);
      const version = bumpSemanticVersion(
        this.#envelope.metadata?.version,
        level,
      );
      this.setMetadata({ ...this.#envelope.metadata, version });
      await this.save();
      options.onSaved(`Released ${version}`);
    } catch (error) {
      options.onError?.(error instanceof Error ? error.message : String(error));
    }
  }

  /** Opens a stored theme, or the reference composition as a template. */
  openLibrary(): Promise<void> {
    return this.#library.open();
  }

  /** Opens one theme the library already holds, by id: the store's own route,
   *  which has read the theme's name off the listing it drew. The replacement
   *  question and the base's bookkeeping are the library's, because this
   *  replaces the open document with a stored one — and `onAccepted` is when
   *  that question is answered. */
  openLibraryTheme(id: string, onAccepted?: () => void): Promise<void> {
    return this.#library.openById(id, onAccepted);
  }

  /** Saves into the host's library, which is the stored document's half of a
   *  save — the package's half is {@link save}. */
  saveLibrary(): Promise<void> {
    return this.#library.save();
  }

  /** Whether this document descends from one the library holds, which is what
   *  a publish reads: a document with no stored base has no folder. */
  isStored(): boolean {
    return this.#library.isStored();
  }

  /**
   * The envelope-side asset references, which no Fabric object carries.
   *
   * The background layer's media is a DOM sibling of the canvas, and a type
   * preset's face is a reference in `globals` — neither is an object, so the
   * canvas walk the asset panel does cannot see either. A font whose bytes went
   * away under a live preset would leave a theme that validates and renders
   * nothing.
   */
  holdsAsset(assetId: string): boolean {
    if (this.#envelope.background?.media?.assetId === assetId) return true;
    const presets = this.#envelope.globals?.typePresets as
      | TypePresets
      | undefined;
    return Object.values(presets ?? {}).some(
      (preset) => preset.value.face?.assetId === assetId,
    );
  }

  /**
   * The document as the author last left it. Every write after the constructor
   * goes through here, so a panel that changes the theme name, a palette token
   * or a binding cannot leave the unsaved marker reading "saved" — the failure
   * being one setter missing a line, which nothing else would notice.
   */
  #writeEnvelope(envelope: FabricThemeEnvelopeInput): void {
    this.#envelope = envelope;
    this.announceChange();
  }

  setArtboard(artboard: Artboard): void {
    this.#writeEnvelope({ ...this.#envelope, artboard });
    // A geometry change only: the shell re-places the media layer itself, so
    // asking for a remount here would restart a background video on every
    // board ratio change. Asset declarations are what `refreshBackgroundMedia`
    // is for.
    this.#shell.setArtboard(artboard);
    this.#consumers.artboard().render(artboard, this.#envelope.metadata);
  }

  /**
   * Writes the background layer: the envelope section the shell paints from and
   * a save ships. A whole value, because the layer has one owner — a field
   * writes the bag it read back, and nothing here keeps a second copy of it.
   */
  setBackground(background: Background | undefined): void {
    if (background === undefined) {
      // Omitted rather than stored undefined, for `exactOptionalPropertyTypes`.
      const { background: _background, ...withoutBackground } = this.#envelope;
      this.#writeEnvelope(withoutBackground);
    } else {
      this.#writeEnvelope({ ...this.#envelope, background });
    }
    this.#shell.setBackground(background);
  }

  setMetadata(metadata: FabricThemeEnvelopeInput["metadata"]): void {
    if (metadata === undefined || Object.keys(metadata).length === 0) {
      const { metadata: _metadata, ...withoutMetadata } = this.#envelope;
      this.#writeEnvelope(withoutMetadata);
    } else {
      this.#writeEnvelope({ ...this.#envelope, metadata });
    }
    // The language is the one metadata field that changes what is painted, and
    // `metadata` is the only way to set it, so this is the only push site needed
    // — unlike the globals fan-out above, which every globals setter goes
    // through rather than repeating the receiver list.
    this.#pushLocale();
  }

  #pushLocale(): void {
    const themeLanguage = this.#envelope.metadata?.themeLanguage;
    // Two receivers, not four: the editor paints bound text only through the
    // live runtime, and the inspector's run preview is the other place a
    // formatted reading is written. `runs.ts`'s own `applyAuthoredText` calls
    // pass no bindings, so they resolve no reading and need no language.
    this.#consumers.runtime().setThemeLanguage(themeLanguage);
    this.#consumers.selection().setLocale(themeLanguage);
  }

  /** The shell renders the artboard's background media from these declarations
   *  and this byte lookup, so a declared asset that changed is re-resolved
   *  through the one path that owns the bytes. */
  refreshBackgroundMedia(): void {
    this.#shell.setBackgroundMedia(this.#assets.declarations, (assetId) =>
      this.#assets.backgroundSource(assetId),
    );
  }

  setBindings(id: string, bindings: readonly Binding[]): void {
    this.addBindings({ [id]: bindings });
  }

  /**
   * The one writer of the envelope's bindings, whoever is writing them.
   *
   * A single object's list and an inserted card's whole subtree are the same
   * fact — a reading is keyed by the object that shows it — so they share one
   * write and one fan-out. Charts are in that fan-out because a chart's series
   * *are* its bindings: a chart manager holding only what it was constructed
   * with draws every inserted card's sparkline with no series at all.
   */
  addBindings(additions: Readonly<Record<string, readonly Binding[]>>): void {
    this.#writeEnvelope({
      ...this.#envelope,
      bindings: { ...this.#envelope.bindings, ...additions },
    });
    const bindings = this.#envelope.bindings ?? {};
    this.#consumers.runtime().setBindings(bindings);
    this.#consumers.charts().setBindings(bindings);
    this.#onBindingsChange?.();
  }

  /** One card, as a unit. The copy's readings are envelope state, so they land
   *  through the one writer above rather than beside it.
   *
   * **The refusal is reported here rather than thrown at a caller.** Two
   * surfaces dispatch this — the Add pane and the canvas context menu — and the
   * menu's entry holds a `void`, so a thrown refusal reached nobody there: the
   * author clicked a card, nothing happened, nothing was said, and an unhandled
   * rejection went to the console. Reporting at the one owner is what makes it
   * told once on every surface, and the Add pane's `constructing` does not
   * double-report because nothing rejects.
   */
  insertCard(cardId: string): void {
    void insertCard(this.#shell.editor, cardId, {
      globals: this.#envelope.globals,
      ...(this.#envelope.bindings === undefined
        ? {}
        : { bindings: this.#envelope.bindings }),
      onBindings: (bindings) => this.addBindings(bindings),
    }).catch((error: unknown) => {
      this.#shell.editor.errorManager.warn(
        "controls",
        error instanceof Error ? error.message : String(error),
      );
    });
  }

  /**
   * Every owner that reads the theme's globals, handed the new value once.
   *
   * The receivers used to be listed inline, once per setter, and the lists
   * disagreed: `setPalette` reached six, `setTypes` three, `deleteType` two.
   * A consumer a setter did not happen to name stopped updating — `setTypes`
   * never told the selection inspector, which then painted a renamed type preset
   * from the globals it already held (`vg-232`). One list is what makes the
   * omission unrepresentable: a setter cannot drop a receiver by not naming it.
   */
  #globalsChanged(): void {
    const globals = this.#envelope.globals;
    this.#shell.setGlobals(globals);
    this.#consumers.runtime().setGlobals(globals);
    this.#consumers.charts().setGlobals(globals);
    this.#consumers.newObjects().setGlobals(globals);
    this.#consumers.selection().setGlobals(globals);
  }

  setPalette(palette: FabricPalette): void {
    this.#writeEnvelope({
      ...this.#envelope,
      globals: { ...this.#envelope.globals, palette },
    });
    this.#globalsChanged();
    this.#consumers.palette().render(palette);
  }

  deletePalette(id: string, replacement: string): void {
    if (id === "none" || id === replacement) return;
    const { from, to, background, palette } = reassignPaletteToken(
      this.#shell.editor.canvas,
      this.#envelope.background,
      this.#envelope.globals?.palette ?? {},
      id,
      replacement,
    );
    this.#consumers.charts().reassignPaletteReferences(from, to);
    // The artboard did not change, so nothing writes it: the colour the token
    // painted now lives in the background layer, so the shell is told the new
    // bag directly or the stage keeps painting the deleted token.
    this.#writeEnvelope({
      ...this.#envelope,
      ...(background === undefined ? {} : { background }),
      globals: { ...this.#envelope.globals, palette },
    });
    // After the globals fan-out: the new bag still names the token the palette
    // no longer has, so it has to be repainted against the palette it now names.
    this.#globalsChanged();
    this.#shell.setBackground(background);
    this.#consumers.palette().render(palette);
  }

  setTypes(typePresets: TypePresets): void {
    this.#writeEnvelope({
      ...this.#envelope,
      globals: { ...this.#envelope.globals, typePresets },
    });
    this.#globalsChanged();
    this.#consumers.types().render(typePresets);
  }

  deleteType(id: string, replacement: string): void {
    if (id === replacement) return;
    const typePresets = reassignTypePresetToken(
      this.#shell.editor.canvas,
      (this.#envelope.globals?.typePresets ?? {}) as TypePresets,
      id,
      replacement,
    );
    this.#writeEnvelope({
      ...this.#envelope,
      globals: { ...this.#envelope.globals, typePresets },
    });
    this.#globalsChanged();
    this.#consumers.types().render(typePresets);
  }

  async applyFontTrio(id: string): Promise<FabricThemeEnvelope> {
    const trio = fontTrio(id);
    if (trio === undefined) throw new Error(`Unknown font trio "${id}".`);
    const bytes = await Promise.all(
      trio.faces.map((face) => this.#downloadFace(face)),
    );
    for (const [index, face] of trio.faces.entries()) {
      await this.#assets.adoptFont(face, bytes[index]!);
    }
    const presets = this.#envelope.globals?.typePresets as
      | TypePresets
      | undefined;
    if (presets !== undefined) this.setTypes(applyFontTrio(presets, trio));
    this.#shell.editor.historyManager.saveState();
    return this.snapshot();
  }

  async applyPresetFace(
    id: string,
    face: CuratedFontFace,
  ): Promise<FabricThemeEnvelope> {
    const presets = this.#envelope.globals?.typePresets as
      | TypePresets
      | undefined;
    const preset = presets?.[id];
    if (preset === undefined) throw new Error(`Unknown type preset "${id}".`);
    const bytes = await this.#downloadFace(face);
    await this.#assets.adoptFont(face, bytes);
    this.setTypes({
      ...presets,
      [id]: {
        ...preset,
        value: {
          ...preset.value,
          family: face.family,
          weight: face.weight,
          face: { assetId: face.id },
        },
      },
    });
    this.#shell.editor.historyManager.saveState();
    return this.snapshot();
  }

  async #downloadFace(face: CuratedFontFace): Promise<Uint8Array> {
    const response = await fetch(face.sourceUrl);
    if (!response.ok)
      throw new Error(
        `Could not download ${face.family} (${response.status}).`,
      );
    return new Uint8Array(await response.arrayBuffer());
  }

  /** A font action whose refusal reaches the author in the editor's own words
   *  rather than as a rejection out of a panel's field. */
  async runFontAction(action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.#source.onError?.(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  destroy(): void {
    this.#documentChangeListeners.clear();
    this.#persistence.destroy();
  }
}
