import type {
  AssetPage,
  AssetResult,
  ChartFamily,
  FabricThemeEnvelopeInput,
} from "@yunari/renderer-core";
import type * as React from "react";
import type { ArrangeAction } from "../arrange.js";
import type { AssetPlacement, ImportOutcome } from "../asset-finder/actions.js";
import type { FontActions } from "../asset-finder/fonts.js";
import type { ShapeKind } from "../new-object-defaults.js";

/** Document-level editor actions the shell dispatches. Every method delegates to
 * an existing owner; the façade adds reachability, never logic. */
export interface EditorActionFacade {
  newDocument(): Promise<void>;
  /** The reference composition as a template, not what `New` means. */
  newFromStarter(): Promise<void>;
  /** The package picker. An import writes into the library and leaves the open
   *  document alone, so this replaces nothing. */
  importPackage(): void;
  savePackage(): Promise<void>;
  releasePackage(): Promise<void>;
  openLibrary(): Promise<void>;
  /** The finder's Fonts pane: the role presets and the writes a chosen result
   *  offers. The shell draws the buttons; the session owns their effects. */
  fontActions?(): FontActions;
  /** The finder's Wallpaper Engine body: this PC's library, and the session's
   *  three writes a card offers — a video's background, a scene's local project
   *  and a picked `.mpkg`. */
  wallpaperEngineBody?(): React.ReactNode;
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
  saveLibrary(): Promise<void>;
  addText(): void;
  /** The canvas context menu's route to a primitive; the Add pane's own
      buttons call the same construction rather than a second copy of it. */
  addShape(kind: ShapeKind): void;
  addChart(family: ChartFamily): void;
  /** The canvas context menu's route to the unit library, for the same reason. */
  insertCard(cardId: string): void;
  arrange(action: ArrangeAction): boolean;
  canArrange(action: ArrangeAction): boolean;
  undo(): void;
  redo(): void;
  copy(): void;
  cut(): void;
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

/** Editor-main owns these; the View menu dispatches through them. */
export interface EditorViewControls {
  readonly sourceMode: () => "preview" | "live";
  setSourceMode(mode: "preview" | "live"): void;
}
