import type {
  AssetReference,
  Background,
  BackgroundMode,
  Binding,
  FabricGlobals,
  SampleSource,
  SemanticKeyDescriptor,
} from "@yunari/renderer-core";
import type { ChartEdits } from "../chart-manager/chart-fields.js";
import type { EditorInteraction } from "../editor-interaction.js";
import type { FavoritesClient } from "../favorites-client.js";
import type { TypeTokenFontActions } from "../type-preset-manager/panel.js";
import type { ChartFieldsPort } from "./per-kind-column.js";
import type { DesignTokenPort } from "./design-token-editor.js";

/**
 * What the inspector asks the session for. Every optional entry is a capability
 * the owning surface may not be mounted; the column is told rather than handed a
 * port that silently does nothing.
 */
export interface SelectionInspectorOptions {
  readonly editor: EditorInteraction;
  /** Theme globals, so a token's resolution can be shown. */
  readonly globals?: FabricGlobals;
  /**
   * A node's bindings, and the way to write them back. They belong to the theme
   * envelope rather than to the Fabric object, so the session owns them and the
   * inspector asks for them by node id.
   */
  readonly nodeBindings?: (nodeId: string) => readonly Binding[];
  readonly onNodeBindingsChange?: (
    nodeId: string,
    bindings: readonly Binding[],
  ) => void;
  /**
   * The live sample source, so a value run can say whether a reading has
   * arrived for it. A getter rather than a source: the session replaces its
   * source when the author switches between preview and live, and the panel is
   * mounted for the session rather than rebuilt.
   */
  readonly sampleSource?: () => SampleSource;
  /** The readings a run may name, pulled at render time like the sample source
   *  so a catalogue refreshed after mount reaches the next projection. Absent
   *  keeps the built-in vocabulary. */
  readonly descriptors?: () => readonly SemanticKeyDescriptor[];
  /** The keys the host answers now, or `undefined` before it has said. */
  readonly measured?: () => ReadonlySet<string> | undefined;
  /** Every key the theme binds; a bound key the host does not answer is the
   *  state the reading list marks red. Absent means no bound set was supplied. */
  readonly bound?: () => ReadonlySet<string>;
  /**
   * Re-resolves the glass lifecycle. The handle belongs to the shell that
   * created it and re-resolves on its own only when the canvas gains or loses
   * an object, so an authored treatment written on a panel that is already
   * there reaches it through this. Required rather than optional: without it the
   * enable control would accept an edit and paint nothing.
   */
  readonly refreshGlass: () => void;
  /**
   * The chart owner's own fields, for a chart selection.
   *
   * A getter rather than the port: the chart manager is built after this
   * inspector, in the session that owns both, so the column asks for them at
   * render time — and the owner a later document mount replaces is the one it
   * gets.
   */
  readonly chartFields?: () => ChartFieldsPort | undefined;
  /**
   * The writes those chart fields make, from the same owner.
   *
   * A second getter rather than a member of the port, for the reason
   * `nodeBindings` and `onNodeBindingsChange` are two: the read half projects
   * into a value the column holds, and the write half is never carried into one.
   * A chart's commit resolves the chart by its own id, so `SelectionEdits`'
   * revision guard has nothing to compare and is not the rule here.
   */
  readonly chartEdits?: () => ChartEdits | undefined;
  /**
   * The font catalogue's writes, from the owner that already performs them for
   * the Tokens pane.
   *
   * The same two actions and no second implementation: a face is bound to a
   * preset and a trio rewrites every preset that names a role, so the rule is
   * the type-preset owner's and this asks for it. **Absent means no face field**
   * — a catalogue browser whose every press did nothing would be worse than the
   * field being absent, so the column is told the capability rather than handed
   * a port that swallows it.
   */
  readonly fontActions?: TypeTokenFontActions;
  /**
   * The author's favourite trios, which the host keeps rather than the document.
   * Absent reads as none and stores none, which is the standalone editor's own
   * answer rather than a failure.
   */
  readonly favoritesClient?: FavoritesClient;
  /**
   * Whether the shell's selection is the background layer. The background is no
   * Fabric object, so this is the only way the column can describe it, and the
   * shell is the one owner of the flag (`EditorShellBridge.backgroundSelected`).
   */
  readonly backgroundSelected?: () => boolean;
  /**
   * The live background, pulled rather than held: it is envelope state the
   * document owns, and a copy taken when the panel was built would go stale on
   * the first write.
   */
  readonly background?: () => Background | undefined;
  /** The declared pictures the background's media field offers. */
  readonly assets?: () => readonly AssetReference[];
  /** Writes a whole background through the document, which owns the envelope. */
  readonly onBackgroundChange?: (next: Background | undefined) => void;
  /** Changes which declared asset the background shows, through the document's
   *  one switch seam. Absent means the media field is not written by this
   *  inspector, rather than a write that resets the asset's geometry. */
  readonly onBackgroundAssetSelect?: (assetId: string | undefined) => void;
  /** Enters or leaves the advanced background model, through the document. */
  readonly onBackgroundModeChange?: (mode: BackgroundMode) => void;
  /** Opens the finder on Fonts, where the catalogue now lives. Absent in a
   *  panel built without the shell's finder. */
  readonly onOpenFontPicker?: () => void;
  /** Opens that same finder from a run's token list. The session passes the
   *  same shell port as `onOpenFontPicker`; two ports because the two surfaces
   *  ask separately, not because the answers differ. */
  readonly openFontFinder?: () => void;
  /** Imports a local font and hands back the token the commit produced or
   *  adopted, so the run that asked can point itself at it. Absent where the
   *  session has no import dialog behind the column. */
  readonly importLocalFont?: (onImported: (tokenId: string) => void) => void;
  /**
   * The design token editor the run rows reach: the same actions the token
   * inspector uses, the live document read, creation and the pane reveal.
   * Absent means no Tokens pane behind this column, and the rows then draw no
   * edit action and no add entry rather than controls whose writes go nowhere.
   */
  readonly designTokens?: DesignTokenPort | undefined;
}
