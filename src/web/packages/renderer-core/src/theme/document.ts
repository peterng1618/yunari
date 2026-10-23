import type { BarSettings } from "../charts/bar.js";
import type { LineSettings } from "../charts/line.js";
import type { PieSettings } from "../charts/pie.js";
import type { GaugeSettings } from "../types.js";
import { isCatalogueId } from "./catalogue-index.js";

/** The theme's authored vocabulary: artboard, globals, bindings, text runs and assets. */

export const MAX_ARTBOARD_DIMENSION = 16384;

/** Stable IDs are separate from display names so renaming preserves references. */
export const STABLE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Necessary asset-path shape; validator also rejects `.`/`..` segments. */
export const ASSET_PATH_PATTERN = /^assets\/[A-Za-z0-9._/-]{1,200}$/;

/** A style tag's shape. Exported so the editor's field refuses exactly what the
 *  validator refuses; the *vocabulary* is the catalogue's and lives nowhere here. */
export const TAG_PATTERN = /^[a-z0-9-]{1,24}$/;

/** How many style tags one theme may declare. The facet reads them; this caps them. */
export const MAX_TAGS = 5;

/** Chosen import bounds, not measured rendering limits. */
export const MAX_NODE_DEPTH = 32;
export const MAX_NODE_COUNT = 5000;

const SEMANTIC_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

export function isSemanticVersion(value: string): boolean {
  return SEMANTIC_VERSION.test(value);
}

export function bumpSemanticVersion(
  version: string | undefined,
  level: "major" | "minor" | "patch",
): string {
  if (version === undefined) return "0.1.0";
  const parts = SEMANTIC_VERSION.exec(version);
  if (parts === null)
    throw new Error("A release version must be semantic major.minor.patch.");
  const major = Number(parts[1]);
  const minor = Number(parts[2]);
  const patch = Number(parts[3]);
  if (level === "major") return `${major + 1}.0.0`;
  if (level === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * The catalogue item a document was remixed from — the immediate parent only.
 *
 * `catalogueId` is what a link resolves through; `name` and `version` are the
 * snapshot printed when the parent is no longer in the index. Provenance, not
 * a live reference: the parent's existence is never checked here.
 */
export interface ThemeRemix {
  readonly catalogueId: string;
  readonly name: string;
  readonly version: string;
}

/** The published remix shape, and the whole of what the format enforces. */
export function isThemeRemix(value: unknown): value is ThemeRemix {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) => key !== "catalogueId" && key !== "name" && key !== "version",
    )
  )
    return false;
  const catalogueId = record["catalogueId"];
  const name = record["name"];
  const version = record["version"];
  return (
    typeof catalogueId === "string" &&
    isCatalogueId(catalogueId) &&
    typeof name === "string" &&
    name.length > 0 &&
    typeof version === "string" &&
    isSemanticVersion(version)
  );
}

export const GLOBAL_GROUPS = [
  "palette",
  "typePresets",
  "fonts",
  "fontSizes",
  "spacing",
  "assets",
] as const;
export type GlobalGroupName = (typeof GLOBAL_GROUPS)[number];

export const NODE_TYPES = [
  "group",
  "rectangle",
  "ellipse",
  "line",
  "text",
  "chart",
  "image",
  "video",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const CHART_FAMILIES = ["gauge", "line", "bar", "pie"] as const;
export type ChartFamily = (typeof CHART_FAMILIES)[number];

export type GlobalRef = `${GlobalGroupName}.${string}`;

/** A style value is exclusively a token reference or a literal. */
export type StyleValue =
  | { readonly ref: GlobalRef; readonly value?: never }
  | { readonly value: unknown; readonly ref?: never };

export type StyleMap = Readonly<Record<string, StyleValue>>;

export interface GlobalEntry {
  /** Display name; references use the map key. */
  readonly name: string;
  readonly value: unknown;
}

/** Palette paint is structured so gradients retain their authored geometry. */
export type PalettePaint =
  | { readonly kind: "solid"; readonly color: string }
  | {
      readonly kind: "gradient";
      readonly angle: number;
      readonly stops: readonly {
        readonly offset: number;
        readonly color: string;
      }[];
    };

/** One reusable typography treatment, applied independently to each text run. */
export interface TypePreset {
  readonly family: string;
  readonly size: number;
  readonly weight?: string | number;
  readonly letterSpacing?: number;
  readonly lineHeight?: number;
  readonly face?: { readonly assetId: string };
  readonly trioRole?: "heading" | "body" | "mono";
}

export type GlobalGroup = Readonly<Record<string, GlobalEntry>>;
export type Globals = Readonly<Partial<Record<GlobalGroupName, GlobalGroup>>>;

export interface Artboard {
  readonly width: number;
  readonly height: number;
  /**
   * How the artboard's *content* fills the viewport. Not the background media,
   * which is always `cover` and has no fit of its own; this is a guarantee of
   * the model rather than a choice, and absent means contain.
   */
  readonly contentFit?: "contain" | "cover";
}

/** The two boxes a background media layer can be sized to. Exported because the
 *  validator and the published schema both name this set, and the schema test
 *  holds them to this list rather than to a copy of it. */
export const BACKGROUND_MEDIA_BOUNDS = ["theme", "display"] as const;
export type BackgroundMediaBounds = (typeof BACKGROUND_MEDIA_BOUNDS)[number];

/** Refused, never clamped: an offset outside these is an authoring bug, not a
 *  reading to round into range. */
export const MIN_BACKGROUND_OFFSET = -1;
export const MAX_BACKGROUND_OFFSET = 1;

/** The values that reproduce the centred cover the renderer painted before the
 *  media had geometry of its own. Flips default to false, i.e. omitted. */
export const BACKGROUND_MEDIA_DEFAULTS = {
  offsetX: 0,
  offsetY: 0,
} as const;

export interface BackgroundMedia {
  readonly assetId: string;
  /** The box the layer is clipped to: the artboard rect or the display rect. */
  readonly bounds: BackgroundMediaBounds;
  /** Moves the centre by a fraction of the box's own dimensions; absent means 0.
   *  Placement bounds the pan to the cover rect's overhang, so it cannot expose
   *  the box. */
  readonly offsetX?: number;
  readonly offsetY?: number;
  /** A paint-time mirror about the placed rect's centre; absent means false. */
  readonly flipX?: boolean;
  readonly flipY?: boolean;
}

/**
 * The bottom-most layer of the composition.
 *
 * `color` fills the board and the letterbox bars around it under
 * `bounds: "theme"` — one paint, so the two cannot disagree. It sits behind the
 * media, so it shows wherever the media does not cover; with `cover` that is
 * never inside the media's box.
 */
export interface Background {
  readonly color?: StyleValue;
  readonly media?: BackgroundMedia;
}

/** Themes bind semantic keys, never provider-instance IDs. */
export interface Binding {
  readonly id: string;
  readonly semanticKey: string;
  readonly precision?: number;
  readonly unitDisplay?: "none" | "short" | "long";
  readonly scale?: number;
  readonly offset?: number;
  /**
   * How a time/date reading is written out (`HH:mm`, `dddd DD MMMM`). How a clock
   * *reads* is design, so the author owns it; how a value *is formatted* for its
   * unit stays derived. Absent means the key's own default format.
   */
  readonly format?: string;
  /**
   * The zone this reading is shown in — a world-clocks theme pins one clock to
   * `Asia/Tokyo` while another follows the consumer. Absent means this PC's zone.
   */
  readonly timeZone?: string;
}

export type TextRun =
  | {
      readonly kind: "literal";
      readonly text: string;
      readonly typePreset?: `typePresets.${string}`;
      readonly style?: StyleMap;
    }
  | {
      readonly kind: "value";
      /** References a binding on the same node. */
      readonly bindingId: string;
      readonly precision?: number;
      readonly unitDisplay?: "none" | "short" | "long";
      readonly typePreset?: `typePresets.${string}`;
      readonly style?: StyleMap;
    };

/**
 * The author's fixed box, in scene units.
 *
 * Fabric's `Textbox` derives its width from the longest unbreakable run and its
 * height from its line count, so neither is available to hold a box the text
 * cannot widen. This is the copy that survives a save; the Fabric object's own
 * width is a cache this re-asserts. The box's top-left is the object's
 * `left`/`top`, so only the two dimensions belong here.
 */
interface TextBox {
  readonly width: number;
  readonly height: number;
}

export interface TextContent {
  readonly runs: readonly TextRun[];
  /**
   * The fixed box. Absent means the text measures its own, which is what a
   * document saved before fixed boxes existed keeps doing.
   */
  readonly box?: TextBox;
  readonly wrap?: boolean;
  readonly overflow?: "clip" | "ellipsis" | "visible";
  readonly align?: "left" | "center" | "right";
  readonly verticalAlign?: "top" | "middle" | "bottom";
}

/** Chart settings stay discriminated by family and share adapter-owned setting types. */
export type ChartContent =
  | { readonly family: "gauge"; readonly settings: GaugeSettings }
  | { readonly family: "line"; readonly settings: LineSettings }
  | { readonly family: "bar"; readonly settings: BarSettings }
  | { readonly family: "pie"; readonly settings: PieSettings };

/** The unit a card was authored as, on the starter and on a copy; not a live
 * library link. */
export interface WidgetProvenance {
  readonly widgetId: string;
  readonly widgetName?: string;
  readonly widgetVersion?: string;
  readonly insertedAt?: string;
}

export interface AssetLicense {
  readonly name?: string;
  readonly url?: string;
  readonly attribution?: string;
}

/** Asset type is declared explicitly; renderers should not infer it from the path. */
export type AssetKind = "image" | "svg" | "gif" | "video" | "font";

export interface AssetReference {
  readonly id: string;
  readonly kind: AssetKind;
  readonly path: string;
  readonly sha256?: string;
  readonly sourceUrl?: string;
  readonly license?: AssetLicense;
}

export interface FontAssetReference extends AssetReference {
  readonly kind: "font";
  readonly family: string;
  readonly weight: string | number;
  readonly style: "normal" | "italic";
  readonly format: "woff2";
  readonly sourceUrl: string;
  readonly license: AssetLicense;
}

export interface ThemeMetadata {
  readonly name?: string;
  readonly author?: string;
  readonly description?: string;
  readonly version?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  /**
   * The language this theme's text is written in, as a BCP 47 tag. Required on
   * the envelope: text a theme shows belongs to the theme's language, and a
   * theme library filters on it.
   *
   * Named for the language rather than the locale: the value is a bare language
   * tag from the curated list, and it states a fact about this theme rather than
   * the runtime's formatting preferences. See docs/decisions/0022.
   */
  readonly themeLanguage?: string;
  /**
   * Style tags the author picked from the catalogue's vocabulary. The shape and
   * the count are the format's whole rule: membership is unchecked, because a tag
   * the vocabulary does not yet know has to be writable before it can join it, and
   * duplicates are the facet's to collapse. See docs/decisions/0087.
   */
  readonly tags?: readonly string[];
  /** The catalogue item this theme was remixed from, if any. */
  readonly remixOf?: ThemeRemix;
}
