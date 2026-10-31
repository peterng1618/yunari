import {
  type Artboard,
  type Background,
  type Binding,
  bumpSemanticVersion,
  type FabricGlobals,
  type FabricPalette,
  type FabricThemeEnvelope,
  type FabricThemeEnvelopeInput,
  type FontAssetReference,
  type FontCut,
  type FontTrioInfo,
  isTypeTokenRole,
} from "@yunari/renderer-core";
import { isLocked, isTextObject } from "@yunari/scene-fabric";
import {
  checkDeclaredAssets,
  MAX_CREDITS_ENTRIES,
  type ThemeCredits,
  type ThemeCreditsEntry,
} from "@yunari/theme-package";
import { IText } from "fabric/es";
import type { ArtboardPanel } from "./artboard-panel.js";
import { assetBytes, familyCuts, trashAssets } from "./asset-finder/client.js";
import {
  type AssetManager,
  assetFileName,
  type LocalAssetReference,
} from "./asset-manager/index.js";
import { unusedAssets as computeUnusedAssets } from "./asset-manager/unused.js";
import { insertCard } from "./card-library.js";
import type { ChartManager } from "./chart-manager/index.js";
import {
  confirmSaveCleanup,
  type SaveCleanupFile,
} from "./components/save-cleanup-dialog.js";
import type { EditorShell } from "./editor-shell.js";
import {
  applyFontTrio as applyCatalogTrio,
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
import { textToOutlines } from "./text-outlines.js";
import type { ThemeLibraryClient } from "./theme-library-client.js";
import { ThemeLibraryManager } from "./theme-library-manager/index.js";
import { captureThumbnail } from "./thumbnail-capture.js";
import {
  applyFontTrio as applyTrioPresets,
  FONT_ROLES,
  type FontTrioRole,
  fontAssetId,
  fontWeight,
  freePresetId,
  presetForRole,
  rolePreset,
} from "./type-preset-apply.js";
import {
  reassignTypeToken,
  type TypeTokenPanel,
  type TypeTokens,
} from "./type-preset-manager/index.js";
import { tokenIdOfFace } from "./type-token-manager/name.js";
import { uiCopy } from "./ui-copy.js";

/** Whether a save may go on. `message` is a host refusal the author must
 *  read; a cancel carries none. */
export type CleanupAnswer =
  | { readonly proceed: true }
  | { readonly proceed: false; readonly message?: string };

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
  readonly types: () => TypeTokenPanel;
  readonly selection: () => SelectionInspector;
}

interface EditorDocumentOptions {
  readonly source: EditorDocumentSource;
  readonly consumers: EditorDocumentConsumers;
}

/** A credit's identity: the item, where it came from, and the asset it
 *  attributes. A credit written before `assetId` existed has no asset segment,
 *  so its identity is what it always was. */
function creditKey(entry: ThemeCreditsEntry): string {
  return `${entry.source?.url ?? ""}\n${entry.title}\n${entry.assetId ?? ""}`;
}

/**
 * A provider cut as the catalogue face shape the asset manager adopts. The id
 * is the packaged one, because a cut id is a byte address and not a stable id.
 * Both font sources serve woff2; a cut in another format has no adoption path
 * here and is refused rather than mislabelled.
 */
function faceOfCut(cut: FontCut, role: FontTrioRole): CuratedFontFace {
  if (cut.format !== "woff2") {
    throw new Error(
      `"${cut.family}" is not a font file this editor can package.`,
    );
  }
  return {
    id: fontAssetId(cut),
    role,
    family: cut.family,
    weight: fontWeight(cut),
    style: cut.style,
    format: "woff2",
    subset: cut.subset,
    sourceUrl: cut.sourceUrl ?? cut.previewUrl,
    license: { name: cut.licence },
  };
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
  /** Whether a listener flush is already queued. Set before scheduling, so the
   *  dozens of announcements a paste or a revive makes in one task collapse
   *  into one recompute rather than one per Fabric event. */
  #announceScheduled = false;
  /** Bumped by every announcement — synchronously, so a reader that asks right
   *  after the change never sees the previous answer. It is also the reading's
   *  key: every asker of the same change shares one serialise-and-validate
   *  rather than each doing its own, which three surfaces did per pointer move
   *  of a palette picker drag. */
  #revision = 0;
  /** The last dirty answer and what it was computed from. A save moves the
   *  baseline without bumping the revision, so it clears this outright; the
   *  manager's mutation count is the other half of the key because an import or
   *  a removal writes the asset map without announcing anything. */
  #dirty:
    | {
        readonly revision: number;
        readonly assets: number;
        readonly value: boolean;
      }
    | undefined;
  /** A stable reference, so whoever registers it can keep it without binding:
   *  the library manager takes it as a port and the session hands it to every
   *  canvas event that means "the document moved". */
  readonly announceChange = (): void => {
    this.#revision += 1;
    if (this.#announceScheduled) return;
    this.#announceScheduled = true;
    queueMicrotask(() => {
      // Cleared before the listeners run: an announcement made during the
      // flush is a second batch, so it schedules one more pass rather than
      // being folded into the pass that is already reading stale state.
      this.#announceScheduled = false;
      // A copy, so a listener added or removed during the flush does not
      // change who this batch reaches.
      for (const listener of [...this.#documentChangeListeners]) listener();
    });
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
      credits: () => this.#creditsPackage(),
      picture: () => this.picture(),
      // The baseline, not the document: a save in the same task has bumped no
      // revision, so the memo would answer for the old one.
      markSaved: (theme, assets) => {
        this.#persistence.markSaved(theme, assets);
        this.#dirty = undefined;
      },
      announceChange: this.announceChange,
      errors: source.shell.editor.errorManager,
      confirmReplacement: () => this.confirmReplacement(),
      // The title is the save the author pressed; the library's own is the one
      // this port carries, and the package save passes its own.
      confirmCleanup: () => this.confirmAssetCleanup(uiCopy.file.saveLibrary),
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
    // Undo carries the palette as well as the scene. The shell captured its
    // opening entry before this document existed, so attaching patches that
    // entry with the globals the document opened with.
    this.#shell.editor.historyManager.attachGlobals({
      read: () => this.#envelope.globals,
      write: (globals) => this.#restoreGlobals(globals),
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
      // Always the manager's list, empty included: spreading the envelope would
      // otherwise supply the declarations of the package this document opened
      // from, so removing the last asset would resurrect it here — a document
      // declaring bytes it no longer holds, and reading clean because the
      // baseline carried the same fake.
      assets: this.#assets.declarations,
    });
  }

  /** Whether the document differs from what was last saved. Pulled, never held:
   *  the comparison already exists for the replace prompt, and a stored flag
   *  would be one more thing to keep true. Two JSON passes over the document and
   *  its assets are what the timer, the identity chip and the publish control
   *  used to pay per read — each doing its own on every live palette sample of
   *  a picker drag — so one answer is kept per change, until the revision or an
   *  asset mutation moves. */
  isDirty(): boolean {
    const memo = this.#dirty;
    if (
      memo !== undefined &&
      memo.revision === this.#revision &&
      memo.assets === this.#assets.mutationCount
    ) {
      return memo.value;
    }
    const value = this.#persistence.isDirty(
      this.snapshot(),
      this.#assets.assets,
    );
    this.#dirty = {
      revision: this.#revision,
      assets: this.#assets.mutationCount,
      value,
    };
    return value;
  }

  /** The attribution the saved package will carry, in arrival order. */
  credits(): readonly ThemeCreditsEntry[] {
    return [...this.#credits];
  }

  /** The credit an asset already carries, where one was recorded. The match is
   *  the id the import wrote; a legacy credit has none and answers nothing. */
  creditForAsset(assetId: string): ThemeCreditsEntry | undefined {
    return this.#credits.find((entry) => entry.assetId === assetId);
  }

  /** Whether one more credit can be held: the package writer refuses a list
   *  past its cap, so the refusal happens before the bytes are declared rather
   *  than at the next save. A prune can free a slot, but only by removing the
   *  asset that credit attributes. */
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
      // Asked before anything is built, so a refused trash or a cancel leaves
      // no package and no write behind it.
      const cleanup = await this.confirmAssetCleanup();
      if (!cleanup.proceed) {
        if (cleanup.message !== undefined) options.onError?.(cleanup.message);
        return;
      }
      const current = this.snapshot();
      // The package carries the theme's picture so whoever receives the file
      // can see the look without installing anything.
      await this.#persistence.save(
        current,
        this.#assets.assets,
        await this.picture(),
        this.#creditsPackage(),
      );
      // The baseline moved while the revision did not: keep the memo from
      // answering with the pre-save document for the rest of this task.
      this.#dirty = undefined;
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
        // the dim the author is working behind (`vg-527`).
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
        // Save means the library, not a package download. The library manager
        // owns the cleanup question, the base and the failure report; a save
        // that did not land leaves the dirty mark in place, and a replacement
        // must not discard the document behind it.
        await this.#library.save();
        if (this.isDirty()) return false;
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
      // `save`. The library is a folder; the export is not.
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
      // `save()` owns its own errors and a cancelled cleanup returns without
      // writing, so the release is reported only if the document actually
      // stopped being dirty — the same re-read the mode switch makes.
      if (this.isDirty()) return;
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
    const presets = this.#envelope.globals?.typeTokens as
      | TypeTokens
      | undefined;
    // A font is held by its family, not by its exact file: applying one cut
    // adopts every weight and subset of the family, and only the chosen face is
    // bound. Matching the asset id alone made the rest look unused, so the
    // cleanup sheet offered the Vietnamese and bold faces for the trash.
    const declared = this.#assets.declarations.find(
      (asset) => asset.id === assetId,
    );
    const family =
      declared !== undefined && "family" in declared
        ? declared.family
        : undefined;
    return Object.values(presets ?? {}).some(
      (preset) =>
        preset.face?.assetId === assetId ||
        (family !== undefined && preset.family === family),
    );
  }

  /** The declarations neither the envelope nor the scene still references. The
   *  one walk: the helper owns reachability, this owner supplies its inputs. */
  unusedAssets(): readonly LocalAssetReference[] {
    return computeUnusedAssets({
      declarations: this.#assets.declarations,
      objects: this.#source.shell.editor.canvas.getObjects(),
      holdsAsset: (assetId) => this.holdsAsset(assetId),
    });
  }

  /** Removes the declarations, their bytes, their preview URLs and the credits
   *  whose `assetId` is in `ids`. A credit with no `assetId` is kept. */
  pruneAssets(ids: readonly string[]): void {
    // A caller's list can be stale by the time it confirms — the author can
    // place or bind an asset in between — so reachability is re-read, never
    // trusted. An id the manager no longer declares is not in this set either.
    const unused = new Set(this.unusedAssets().map((asset) => asset.id));
    const pruned = ids.filter((id) => unused.has(id));
    if (pruned.length === 0) return;
    for (const id of pruned) this.#assets.remove(id);
    const removed = new Set(pruned);
    for (let index = this.#credits.length - 1; index >= 0; index -= 1) {
      const assetId = this.#credits[index]?.assetId;
      if (assetId !== undefined && removed.has(assetId))
        this.#credits.splice(index, 1);
    }
    // Not a history write: the manager's own Remove is not undoable either,
    // and this only announces so the unsaved marker and panels re-read.
    this.announceChange();
  }

  /**
   * The one owner of the cleanup question both saves ask.
   *
   * Nothing unused means nothing to ask and the save runs unchanged. A
   * dismissal is a cancel, never a keep: closing the sheet is not permission to
   * remove a file. `"remove"` proves the post-prune package buildable, and only
   * a proof that passed moves the files to the host's trash; only a trash that
   * succeeded prunes. A refusal stops the save with the host's or the
   * serializer's own sentence, so nothing is removed and nothing is written.
   */
  async confirmAssetCleanup(
    title: string = uiCopy.file.savePackage,
  ): Promise<CleanupAnswer> {
    const unused = this.unusedAssets();
    if (unused.length === 0) return { proceed: true };

    const assets = this.#assets.assets;
    const files: SaveCleanupFile[] = unused.map((asset) => {
      const previewUrl =
        asset.kind === "image" || asset.kind === "svg"
          ? this.#assets.previewUrl(asset.id)
          : undefined;
      return {
        name: assetFileName(asset),
        kind: asset.kind,
        // A declaration with no bytes is already broken; it contributes nothing
        // to either size rather than inventing one.
        sizeBytes: assets[asset.path]?.byteLength ?? 0,
        reason: uiCopy.saveCleanup.reason[asset.kind],
        ...(previewUrl === undefined ? {} : { previewUrl }),
      };
    });
    const documentName = this.#envelope.metadata?.name;
    const answer = await confirmSaveCleanup({
      title,
      ...(documentName === undefined ? {} : { documentName }),
      files,
      themeBytes: this.#themeBytes(unused),
    });
    if (answer === "cancel") return { proceed: false };
    if (answer === "keep") return { proceed: true };

    // The trash move is ordered last, after the save is otherwise ready: a
    // package the writer would refuse must cost nothing but the refusal, not
    // files already in the Recycle Bin. The candidate asks the writer's own
    // asset check rather than building a package it would throw away.
    // Declarations and bytes only: the credits cap is the one writer refusal
    // this cannot reproduce — unreachable while `canAddCredit` and the credits
    // reader bound the list, reachable from a hand-edited package that seeds
    // `#credits` past it.
    const unusedIds = new Set(unused.map((asset) => asset.id));
    const unusedPaths = new Set(unused.map((asset) => asset.path));
    const candidate = checkDeclaredAssets(
      {
        assets: this.#assets.declarations.filter(
          (asset) => !unusedIds.has(asset.id),
        ),
      },
      Object.fromEntries(
        Object.entries(assets).filter(([path]) => !unusedPaths.has(path)),
      ),
    );
    if (!candidate.ok) return { proceed: false, message: candidate.message };

    const outcome = await trashAssets(
      unused.map((asset) => ({
        name: assetFileName(asset),
        bytes: assets[asset.path] ?? new Uint8Array(),
      })),
    );
    if (!outcome.ok) return { proceed: false, message: outcome.message };
    this.pruneAssets(unused.map((asset) => asset.id));
    return { proceed: true };
  }

  /** The theme's own size, without the files the cleanup is about: the
   *  envelope as JSON plus the bytes still referenced. */
  #themeBytes(unused: readonly LocalAssetReference[]): number {
    const unusedIds = new Set(unused.map((asset) => asset.id));
    const assets = this.#assets.assets;
    let bytes = new TextEncoder().encode(
      JSON.stringify(this.snapshot()),
    ).byteLength;
    for (const asset of this.#assets.declarations) {
      if (unusedIds.has(asset.id)) continue;
      bytes += assets[asset.path]?.byteLength ?? 0;
    }
    return bytes;
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
  addBindings(
    additions: Readonly<Record<string, readonly Binding[]>>,
    removed: readonly string[] = [],
  ): void {
    const bindings = Object.fromEntries(
      Object.entries({ ...this.#envelope.bindings, ...additions }).filter(
        ([id]) => !removed.includes(id),
      ),
    );
    const { bindings: _previous, ...withoutBindings } = this.#envelope;
    this.#writeEnvelope(
      removed.length > 0 && Object.keys(bindings).length === 0
        ? withoutBindings
        : { ...withoutBindings, bindings },
    );
    const live = this.#envelope.bindings ?? {};
    this.#consumers.runtime().setBindings(live);
    this.#consumers.charts().setBindings(live);
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

  /** Replaces the selected text with the same object, frozen into paths.
   *
   *  The replacement keeps the object's id and name, so the layer row and any
   *  selection that names it still resolve, but the binding keyed by that id is
   *  removed: the paths are the reading now, and a live sensor can no longer
   *  move them. The conversion itself is `text-outlines.ts`'s; this owns only
   *  the scene swap and the envelope write. */
  outlineText(): void {
    const editor = this.#shell.editor;
    const active = editor.canvas.getActiveObject();
    if (active === undefined || !isTextObject(active)) return;
    if (isLocked(active)) {
      editor.errorManager.warn("outline", uiCopy.outline.locked);
      return;
    }
    // A caret is an edit in progress. Exiting commits the typed text through
    // the text manager's own handler first, so the conversion freezes what the
    // author just wrote rather than the authoring view's token.
    if (active instanceof IText && active.isEditing) active.exitEditing();
    const outcome = textToOutlines(active, {
      declarations: this.#assets.declarations.filter(
        (asset): asset is FontAssetReference =>
          asset.kind === "font" && "family" in asset,
      ),
      bytes: this.#assets.assets,
    });
    if (outcome.kind === "refused") {
      editor.errorManager.warn("outline", outcome.reason);
      return;
    }
    const parent = active.group;
    const siblings =
      parent === undefined ? editor.canvas.getObjects() : parent.getObjects();
    const index = siblings.indexOf(active);
    editor.canvas.discardActiveObject();
    if (parent === undefined) editor.canvas.remove(active);
    else parent.remove(active);
    const at = index < 0 ? siblings.length : index;
    if (parent === undefined) editor.canvas.insertAt(at, outcome.group);
    else parent.insertAt(at, outcome.group);
    editor.canvas.setActiveObject(outcome.group);
    const id = active.get("id");
    if (typeof id === "string") this.addBindings({}, [id]);
    editor.historyManager.saveState();
    editor.canvas.requestRenderAll();
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

  /**
   * Puts the globals an undo entry was recorded with back.
   *
   * No history save here: this is reached from the restore itself, and a save
   * would append a second entry per press — the undo would record the state it
   * just undid. Both Tokens consumers are re-rendered because the pane paints
   * what it was last handed, not the envelope it cannot read — and a type
   * preset edit is an undo entry too, so a palette undo can carry presets.
   */
  #restoreGlobals(globals: FabricGlobals | undefined): void {
    if (globals === undefined) {
      const { globals: _globals, ...withoutGlobals } = this.#envelope;
      this.#writeEnvelope(withoutGlobals);
    } else {
      this.#writeEnvelope({ ...this.#envelope, globals });
    }
    this.#globalsChanged();
    this.#consumers.palette().render(globals?.palette);
    this.#consumers
      .types()
      .render(globals?.typeTokens as TypeTokens | undefined);
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
    // Before the fan-out, so a chart repaints against the paint it now names.
    this.#consumers.charts().reassignPaletteReferences(from, to);
    this.#deleteGlobalsEntry(
      { ...this.#envelope.globals, palette },
      {
        // The artboard did not change, so nothing writes it: the colour the
        // token painted now lives in the background layer, and the shell is
        // told that bag directly or the stage keeps painting the deleted token.
        background,
        repaint: () => this.#consumers.palette().render(palette),
      },
    );
  }

  setTypes(typeTokens: TypeTokens): void {
    this.#writeEnvelope({
      ...this.#envelope,
      globals: { ...this.#envelope.globals, typeTokens },
    });
    this.#globalsChanged();
    this.#consumers.types().render(typeTokens);
    // Every type-preset field edit arrives here, and each is discrete: no drag
    // publishes samples. Recording at the commit is what makes the edit its own
    // undo step rather than something the next undo silently reverts.
    this.#shell.editor.historyManager.saveState();
  }

  deleteType(id: string, replacement: string): void {
    if (id === replacement) return;
    const typeTokens = reassignTypeToken(
      this.#shell.editor.canvas,
      (this.#envelope.globals?.typeTokens ?? {}) as TypeTokens,
      id,
      replacement,
    );
    this.#deleteGlobalsEntry(
      { ...this.#envelope.globals, typeTokens },
      { repaint: () => this.#consumers.types().render(typeTokens) },
    );
  }

  /**
   * Commits a globals bag that lost one entry of a keyed library.
   *
   * A palette token and a type preset are the same operation over different
   * keys: repoint what named them, write the reduced bag, fan it out, repaint
   * the pane that owns the library, and record the delete as its own undo step.
   * A deletion is a discrete commit with no gesture to settle behind it;
   * without an entry of its own, a later undo's globals restore reverts it.
   *
   * The palette's call site does the two things that are its own: chart series
   * are re-pointed before this call, and the background layer holds the token as
   * a colour reference, so its rewritten background rides the same envelope and
   * reaches the stage after the fan-out.
   */
  #deleteGlobalsEntry(
    globals: FabricGlobals,
    commit: {
      /** Present only when the deleted entry also rewrote the background. */
      readonly background?: Background | undefined;
      readonly repaint: () => void;
    },
  ): void {
    const { background, repaint } = commit;
    // Present even when it rewrote nothing: the shell is told the stage's bag
    // either way, and only a delete that names the background layer passes it.
    const namesBackground = "background" in commit;
    this.#writeEnvelope({
      ...this.#envelope,
      ...(background === undefined ? {} : { background }),
      globals,
    });
    // After the globals fan-out: the new bag still names the entry the library
    // no longer has, so it has to be repainted against what it now names.
    this.#globalsChanged();
    if (namesBackground) this.#shell.setBackground(background);
    repaint();
    this.#shell.editor.historyManager.saveState();
  }

  /** The theme's type presets, or none before the first one is written. */
  #typeTokens(): TypeTokens {
    return (this.#envelope.globals?.typeTokens ?? {}) as TypeTokens;
  }

  /** The cuts a trio names, in reading order. */
  #trioCuts(
    trio: FontTrioInfo,
  ): { readonly cut: FontCut; readonly role: FontTrioRole }[] {
    return FONT_ROLES.flatMap((role) => {
      const cut = trio.roles[role];
      return cut === undefined ? [] : [{ cut, role }];
    });
  }

  /**
   * Every cut a trio's three families publish, stamped with the role of the
   * family it belongs to. The trio result itself carries only the three role
   * cuts, so the rest is asked for by family at import time; a source that
   * cannot enumerate — or a host that predates the route — answers nothing and
   * the role cuts are the import, as before.
   */
  async #trioFamilyCuts(
    trio: FontTrioInfo,
  ): Promise<{ readonly cut: FontCut; readonly role: FontTrioRole }[]> {
    const roleCuts = this.#trioCuts(trio);
    const entries = new Map<
      string,
      { readonly cut: FontCut; readonly role: FontTrioRole }
    >();
    for (const { cut, role } of roleCuts) {
      const family = (await familyCuts(cut.source, cut.family)) ?? [];
      for (const other of family) {
        entries.set(`${other.source}:${other.id}`, { cut: other, role });
      }
    }
    // A role cut the source did not list is still one the trio names.
    for (const entry of roleCuts) {
      entries.set(`${entry.cut.source}:${entry.cut.id}`, entry);
    }
    return [...entries.values()];
  }

  /**
   * Reads every cut's bytes from the host and declares them. Every read and
   * every conversion finishes before the first adoption, so a host that
   * answered nothing leaves the theme untouched rather than half-imported.
   */
  async #adoptCuts(
    entries: readonly { readonly cut: FontCut; readonly role: FontTrioRole }[],
  ): Promise<void> {
    if (entries.length === 0)
      throw new Error("That font names no cut to import.");
    // A face already declared is not asked for again: applying a second preset
    // from the same family must not re-download what the package already holds.
    const declared = new Set(
      this.#assets.declarations.map((asset) => asset.id),
    );
    const read: {
      readonly face: CuratedFontFace;
      readonly bytes: Uint8Array;
    }[] = [];
    for (const entry of entries) {
      if (declared.has(fontAssetId(entry.cut))) continue;
      const face = faceOfCut(entry.cut, entry.role);
      const answer = await assetBytes(entry.cut.source, entry.cut.id);
      if (answer === undefined)
        throw new Error(
          `The host did not send "${entry.cut.family}", so nothing was changed.`,
        );
      read.push({ face, bytes: answer.bytes });
    }
    for (const entry of read) {
      await this.#assets.adoptFont(entry.face, entry.bytes);
    }
  }

  /**
   * Applies a host trio to the theme, or opens a curated one by id for the old
   * picker. The id form is retired with that picker in Task 13.
   */
  async applyFontTrio(id: string): Promise<FabricThemeEnvelope>;
  async applyFontTrio(trio: FontTrioInfo): Promise<void>;
  async applyFontTrio(
    source: string | FontTrioInfo,
  ): Promise<FabricThemeEnvelope | void> {
    if (typeof source === "string") {
      const trio = fontTrio(source);
      if (trio === undefined) throw new Error(`Unknown font trio "${source}".`);
      const bytes = await Promise.all(
        trio.faces.map((face) => this.#downloadFace(face)),
      );
      for (const [index, face] of trio.faces.entries()) {
        await this.#assets.adoptFont(face, bytes[index]!);
      }
      const presets = this.#envelope.globals?.typeTokens as
        | TypeTokens
        | undefined;
      if (presets !== undefined) this.setTypes(applyCatalogTrio(presets, trio));
      return this.snapshot();
    }

    await this.#adoptCuts(await this.#trioFamilyCuts(source));
    this.setTypes(applyTrioPresets(this.#typeTokens(), source));
  }

  /** The three role tokens a trio names, created beside whatever the theme
   *  already has rather than rewriting it. A role already present keeps its
   *  authored face and its cuts are not adopted: creating the role is the only
   *  reason to read those bytes, and the copy promises Add 3 leaves an existing
   *  theme unchanged. A created role brings every weight of its family, so the
   *  token's weight field has the same ladder an import gives it. */
  async addTypeTokensFromTrio(trio: FontTrioInfo): Promise<void> {
    const presets = this.#typeTokens();
    const missing = FONT_ROLES.filter((role) => presets[role] === undefined);
    // Nothing missing is nothing to write: an empty add must not record a
    // history entry for a theme it did not change, and it must not ask the
    // host for cuts it will not adopt.
    if (missing.length === 0) return;
    const families = new Set(
      missing.flatMap((role) => {
        const cut = trio.roles[role];
        return cut === undefined ? [] : [cut.family];
      }),
    );
    const entries = (await this.#trioFamilyCuts(trio)).filter(({ cut }) =>
      families.has(cut.family),
    );
    if (entries.length === 0) return;
    await this.#adoptCuts(entries);
    // Re-read after the await: an author can edit the tokens while the bytes
    // are in flight, and writing the pre-await snapshot would drop that edit.
    let next = this.#typeTokens();
    let added = false;
    for (const role of missing) {
      if (next[role] !== undefined) continue;
      const cut = trio.roles[role];
      if (cut !== undefined) {
        next = { ...next, [role]: rolePreset(cut) };
        added = true;
      }
    }
    if (added) this.setTypes(next);
  }

  /** One token from one cut. A chosen role rewrites that role's token — the
   *  role is the id. With no role chosen the token is unroled, and a face the
   *  theme already carries is pointed at rather than duplicated. */
  async addTypeTokenFromCut(
    cut: FontCut,
    role: FontTrioRole | null,
    /** The family's other faces to bring with it — every weight of the subset
     *  — so the token's weight field has a face to draw. */
    family: readonly FontCut[] = [],
  ): Promise<string> {
    const presets = this.#typeTokens();
    if (role === null) {
      const existing = tokenIdOfFace(presets, cut.family, fontWeight(cut));
      if (existing !== undefined) return existing;
    }
    await this.#adoptCuts([
      { cut, role: role ?? "body" },
      ...family
        .filter((other) => other.id !== cut.id)
        .map((other) => ({ cut: other, role: role ?? "body" })),
    ]);
    // The same re-read as `addTypeTokensFromTrio`: a token edited or created
    // while the bytes were fetched must survive this write.
    const current = this.#typeTokens();
    if (role !== null) {
      this.setTypes({ ...current, [role]: rolePreset(cut) });
      return role;
    }
    const id = freePresetId(current);
    this.setTypes({ ...current, [id]: rolePreset(cut) });
    return id;
  }

  /**
   * One token from a local file already declared in the package.
   *
   * Not routed through `addTypeTokenFromCut`: that path reads the cut's bytes
   * from the host and throws for a local source, while the bytes here are
   * already the manager's.
   */
  addTypeTokenFromLocalFont(
    asset: FontAssetReference,
    role: FontTrioRole | null,
  ): string {
    const weight = Number(asset.weight);
    if (!Number.isFinite(weight) || weight <= 0)
      throw new Error(`"${asset.family}" has no usable font weight.`);
    const entry = presetForRole(asset.family, weight);
    const presets = this.#typeTokens();
    if (role !== null) {
      this.setTypes({
        ...presets,
        [role]: { ...entry, face: { assetId: asset.id } },
      });
      return role;
    }
    const existing = tokenIdOfFace(presets, asset.family, weight);
    if (existing !== undefined) return existing;
    const id = freePresetId(presets);
    this.setTypes({
      ...presets,
      [id]: { ...entry, face: { assetId: asset.id } },
    });
    return id;
  }

  /** Rewrites one named token with a finder cut — the explicit target the
   *  Apply to selected token action names. */
  async applyCutToPreset(
    id: string,
    cut: FontCut,
    family: readonly FontCut[] = [],
  ): Promise<void> {
    const presets = this.#typeTokens();
    const preset = presets[id];
    if (preset === undefined) throw new Error(`Unknown type token "${id}".`);
    const role = isTypeTokenRole(id) ? id : "body";
    await this.#adoptCuts([
      { cut, role },
      ...family
        .filter((other) => other.id !== cut.id)
        .map((other) => ({ cut: other, role })),
    ]);
    const latest = this.#typeTokens();
    const current = latest[id] ?? preset;
    this.setTypes({
      ...latest,
      [id]: {
        ...current,
        family: cut.family,
        weight: fontWeight(cut),
        face: { assetId: fontAssetId(cut) },
      },
    });
  }

  /** Releases a token's packaged face. Family and weight stay as authored and
   *  become editable again (R10). */
  unbindPresetFace(id: string): void {
    const presets = this.#typeTokens();
    const preset = presets[id];
    if (preset === undefined) throw new Error(`Unknown type token "${id}".`);
    if (preset.face === undefined) return;
    const { face: _face, ...value } = preset;
    this.setTypes({ ...presets, [id]: value });
  }

  async applyPresetFace(
    id: string,
    face: CuratedFontFace,
  ): Promise<FabricThemeEnvelope> {
    const presets = this.#envelope.globals?.typeTokens as
      | TypeTokens
      | undefined;
    const preset = presets?.[id];
    if (preset === undefined) throw new Error(`Unknown type token "${id}".`);
    const bytes = await this.#downloadFace(face);
    await this.#assets.adoptFont(face, bytes);
    this.setTypes({
      ...presets,
      [id]: {
        ...preset,
        family: face.family,
        weight: face.weight,
        face: { assetId: face.id },
      },
    });
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
