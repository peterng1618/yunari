import type {
  FabricThemeEnvelope,
  FabricThemeEnvelopeInput,
  SampleSource,
} from "@yunari/renderer-core";
import type { ThemeCreditsEntry } from "@yunari/theme-package";
import type { AssetManager } from "./asset-manager/index.js";
import type { BackgroundMediaMemory } from "./background-media-memory.js";
import type {
  PresetSelection,
  TokenSelectionStore,
} from "./editor-shell/shell-stores.js";
import type { EditorShell } from "./editor-shell.js";
import type { FavoritesClient } from "./favorites-client.js";
import type { IndicatorStore } from "./indicator-manager/store.js";
import type { NewDocumentAnswer } from "./new-document-chooser.js";
import type { SensorCatalogue } from "./sensor-catalogue.js";
import type { ThemeLibraryClient } from "./theme-library-client.js";

export interface EditorPanelHosts {
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

export interface EditorSessionOptions {
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
  /** The package's attribution member, when the session opens one: the
   *  collection every later import is added to. */
  readonly credits?: readonly ThemeCreditsEntry[];
  readonly panelHosts: EditorPanelHosts;
  /** The transform readouts' state. The overlay is the shell's React tree and
   *  this session publishes into it; a session built without chrome keeps its
   *  own store, which nothing renders. */
  readonly indicators?: IndicatorStore;
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
  /** The `?` reference. The sheet is chrome and belongs to `createShellLayout`,
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
  /** The `⌘⇧P`. The chord opens the publish surface and moves nothing: the
   *  host's switch is inside that surface, and reaching it is the author's
   *  second, deliberate press. Optional, like the one above, so a session built
   *  without a shell's chrome simply has no publish chord. */
  readonly onPublishSurface?: () => void;
  /** The shell's own projection of the selection, handed to the preset list so
   *  it says what the canvas selection is set in rather than showing the first
   *  declared preset. Optional for the same reason as above. */
  readonly selection?: PresetSelection;
  /** The shell's token selection, handed to the preset list so a row press
   *  reaches the store the inspector reads. Optional, like `selection`. */
  readonly tokenSelection?: TokenSelectionStore;
  /** Brings one layer into view: the inspector's user list is a set of links,
   *  and the shell owns both the pane column and the canvas selection. Optional
   *  so a session built without chrome draws plain names rather than dead
   *  links. */
  readonly onRevealLayer?: (objectId: string) => void;
  /** Shows the Tokens pane. A run row's "Add new token" creates and applies a
   *  token, then opens the pane that owns its inspector; the pane column is the
   *  shell's, so the gesture leaves through the shell's own door. Optional, so
   *  a session built without chrome still creates and applies. */
  readonly onShowTokens?: () => void;
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
    credits?: readonly ThemeCreditsEntry[],
    /** The sidecar's per-asset background geometry, kept beside the document. */
    backgroundMedia?: BackgroundMediaMemory,
  ) => Promise<void>;
  /** Per-asset background geometry the opened theme keeps beside its document.
   *  Absent for a document that was not opened from the library. */
  readonly backgroundMedia?: BackgroundMediaMemory;
  readonly onSaved: (message?: string) => void;
  readonly onError?: (message: string) => void;
  readonly onBindingsChange?: () => void;
  /** Nothing is saved behind this document — a draft restored after a crash.
   *  It reads as unsaved from its first frame, because it is: the work exists
   *  in the editor and in the draft, and nowhere else. */
  readonly unsaved?: boolean;
}
