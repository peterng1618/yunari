import type {
  AssetPage,
  AssetResult,
  ChartFamily,
  FabricThemeEnvelopeInput,
} from "@yunari/renderer-core";
import type { ArrangeAction } from "../arrange.js";
import type { AssetPlacement, ImportOutcome } from "../asset-finder/actions.js";
import type { FontActions } from "../asset-finder/fonts.js";
import type { WallpaperActions } from "../asset-finder/wallpaper.js";
import type { ShapeInsertion } from "../new-object-defaults.js";
import type { ThemedDisplay } from "../theme-library-client.js";

/** Document-level editor actions the shell dispatches. Every method delegates to
 * an existing owner; the façade adds reachability, never logic. */
export interface EditorActionFacade {
  newDocument(): Promise<void>;
  /** The reference composition as a template, not what `New` means. */
  newFromStarter(): Promise<void>;
  /** The package picker. An import writes into the library and leaves the open
   *  document alone, so this replaces nothing. */
  importPackage(): void;
  /** The plain package download, with no version bump. The toolbar has no row
   *  for it: **Export theme** is the author-facing package export, and it
   *  reaches this same writer through the document's release path. Kept as the
   *  seam for callers that need the package without a release, which the unit
   *  suites are. */
  /** Whether a package was written; `false` is a cancelled cleanup or crop
   *  warning, not a failure. */
  downloadPackage(): Promise<boolean>;
  /** **Export theme**: asks for the release bump, then downloads the package. */
  exportTheme(): Promise<void>;
  /** **Export selection as widget**: downloads the current selection as a
   *  `yunari-widget-package`, or reports why the whole file was refused. */
  exportWidget(): Promise<void>;
  /** **Activate**: saves the document when it is not stored or not clean, then
   *  asks the host to show it on the default display. Never reports success for
   *  a save or an assignment that did not land. */
  activate(): Promise<void>;
  /** The displays this open theme can be put on. Optional: a session with no
   *  host has no list, and the header draws no choice rather than an empty one. */
  listDisplays?(): Promise<{
    readonly default: string | null;
    readonly displays: readonly ThemedDisplay[];
  }>;
  /** Puts the open theme on one display. Saves first through the same path
   *  Activate uses; a save that did not land assigns nothing. */
  assignThemeTo?(display: string): Promise<void>;
  openLibrary(): Promise<void>;
  /** The finder's Fonts pane: the role presets and the writes a chosen result
   *  offers. The shell draws the buttons; the session owns their effects. */
  fontActions?(): FontActions;
  /** The finder's Wallpaper Engine pane: this PC's library, and the session's
   *  three writes a card offers — a video's background, a scene's local project
   *  and a picked `.mpkg`. */
  wallpaperActions?(): WallpaperActions;
  /** One finder row's action: the bytes, the declaration, the credit, and the
   *  kind's own consequence (place an icon, set an image as background). An
   *  image can be asked for the other consequence — `placement: "place"` puts
   *  it on the canvas instead. */
  importAsset?(
    page: AssetPage,
    result: AssetResult,
    placement?: AssetPlacement,
  ): Promise<ImportOutcome>;
  /** One theme the library already holds, by id: the store's own route, which
   *  has read the theme's name off the listing it drew. `onAccepted` runs once
   *  the replacement question is answered and before the theme is read, so a
   *  caller that must move a surface moves it only for an open that happens. */
  openLibraryTheme(id: string, onAccepted?: () => void): Promise<void>;
  /** One theme left the library. A store removal reaches the document's base
   *  through this, so a save after deleting the open theme recreates it. */
  themeRemoved(id: string): void;
  /** A publish wrote and restored this theme's library copy. The open
   *  document's stored base no longer describes the folder, so the next save
   *  must carry every declared byte. */
  themePublished(id: string): void;
  saveLibrary(): Promise<void>;
  /** File's **Open recent**: the newest stored theme that is not the document
   *  that is open. */
  openRecent(): Promise<void>;
  /** The toolbar's **Save as**: writes the open document under a new theme
   *  and continues as it, leaving the theme it came from untouched. */
  saveAs(): Promise<void>;
  addText(): void;
  /** Freezes the selected text, as the author sees it, into vector paths. The
   *  document owns the theme's fonts and the bindings the frozen object stops
   *  using, so the conversion is its own. */
  outlineText(): void;
  /** **Replace file…**: declares a picked image or SVG and re-points the active
   *  object at it, keeping the object's authored box and transform. The file
   *  picker is the session's because the declaration list is. */
  replaceSelectedAsset(): void;
  /** Mirrors the selected picture or path-like shape by rewriting its pixels or
   *  path data; no orientation flag survives in the document. */
  flipSelection(axis: "horizontal" | "vertical"): Promise<void>;
  /** The canvas context menu's route to a primitive; the Add pane's own
      buttons call the same construction rather than a second copy of it. */
  addShape(kind: ShapeInsertion): void;
  addChart(family: ChartFamily): void;
  /** The canvas context menu's route to the unit library, for the same reason. */
  insertCard(cardId: string): void;
  arrange(action: ArrangeAction): boolean;
  canArrange(action: ArrangeAction): boolean;
  undo(): void;
  redo(): void;
  copy(): void;
  cut(): void;
  /** The clipboard's own paste: the held copy first, else the payload a theme
   *  switch left in the browser's store. */
  paste(): void;
  deleteActive(): void;
  duplicate(): void;
  group(): void;
  ungroup(): void;
  /** The document as it stands, and the id a display must fetch its assets
   *  from. `undefined` when this document has never been saved: a published
   *  document's assets come from the theme's folder, so there would be none. */
  publishableDocument():
    | { readonly id: string; readonly envelope: FabricThemeEnvelopeInput }
    | undefined;
  /** Whether the document differs from what was last saved. Pulled, so the
   *  subscription carries no value: it says the document may have moved. */
  isDirty(): boolean;
  subscribeDocumentChange(listener: () => void): () => void;
}

/** Editor-main owns these; the View toggle dispatches through them. */
export interface EditorViewControls {
  readonly sourceMode: () => "preview" | "live";
  setSourceMode(mode: "preview" | "live"): void;
}
