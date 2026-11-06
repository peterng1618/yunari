import type { ArtboardShape } from "../artboard.js";
import type { BarSettings } from "../charts/bar.js";
import type { LineSettings } from "../charts/line.js";
import type { PieSettings } from "../charts/pie.js";
import type { PolarBarSettings } from "../charts/polar-bar.js";
import type { RadarSettings } from "../charts/radar.js";
import type { GaugeSettings } from "../types.js";
import { isCatalogueId } from "./catalogue-index.js";

/** The theme's authored vocabulary: artboard, globals, bindings, text runs and assets. */

export const MAX_ARTBOARD_DIMENSION = 16384;

/** Stable IDs are separate from display names so renaming preserves references. */
export const STABLE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The id a **new** theme document gets. Every producer — the starter, a
 * blank theme, a remix, a duplicate, a Save as — mints through here, so an id
 * is an identity the author can rename around and never a slug of the name.
 * Ids read from an existing document are kept, including older slug-shaped
 * ones; this is only for documents being born.
 */
export function newThemeId(): string {
  return crypto.randomUUID();
}

/** Necessary asset-path shape; validator also rejects `.`/`..` segments. */
export const ASSET_PATH_PATTERN = /^assets\/[A-Za-z0-9._/-]{1,200}$/;

/** A style tag's shape. Exported so the editor's field refuses exactly what the
 *  validator refuses; the *vocabulary* is the catalogue's and lives nowhere here. */
export const TAG_PATTERN = /^[a-z0-9-]{1,24}$/;

/** How many style tags one theme may declare. The facet reads them; this caps them. */
export const MAX_TAGS = 5;

/** The store's item-name bound, in UTF-8 bytes: the document and the
 *  catalogue are the same name, so they share one unit and one number. */
export const MAX_METADATA_NAME_BYTES = 200;

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
  "typeTokens",
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

export const CHART_FAMILIES = [
  "gauge",
  "line",
  "bar",
  "pie",
  "radar",
  "polarBar",
] as const;
export type ChartFamily = (typeof CHART_FAMILIES)[number];

/**
 * How many readings a family draws, per `buildChartPlan`.
 *
 * A gauge reads `bindings[0]` and nothing else, and a radar's more than twelve
 * spokes collapse the polygon at theme sizes. This is the one cap the editor's
 * control, the authoring kit and the MCP tools all enforce.
 */
export const MAX_CHART_BINDINGS: Readonly<Record<ChartFamily, number>> = {
  gauge: 1,
  line: Number.POSITIVE_INFINITY,
  bar: Number.POSITIVE_INFINITY,
  pie: Number.POSITIVE_INFINITY,
  radar: 12,
  polarBar: Number.POSITIVE_INFINITY,
};

export function isChartFamily(value: string): value is ChartFamily {
  return (CHART_FAMILIES as readonly string[]).includes(value);
}

/** Why a family cannot draw this many readings, or `undefined` when it can. */
export function chartBindingCountRefusal(
  family: ChartFamily,
  count: number,
): string | undefined {
  const max = MAX_CHART_BINDINGS[family];
  if (count <= max) return undefined;
  return family === "gauge"
    ? "A gauge reads one binding and draws nothing else."
    : `A ${family} chart draws at most ${max} bindings.`;
}

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

/** One face in the theme's vocabulary: the family, weight and packaged face a
 *  run is set in. Size, leading and tracking belong to the run's own style. */
export interface TypeToken {
  readonly family: string;
  readonly weight?: string | number;
  readonly face?: { readonly assetId: string };
}

/** The three role ids a theme's token set covers; a role is a token id. */
export const TYPE_TOKEN_ROLES = ["heading", "body", "mono"] as const;

export function isTypeTokenRole(
  id: string,
): id is (typeof TYPE_TOKEN_ROLES)[number] {
  return (TYPE_TOKEN_ROLES as readonly string[]).includes(id);
}

export type GlobalGroup = Readonly<Record<string, GlobalEntry>>;
export type Globals = Readonly<{
  [K in GlobalGroupName]?: K extends "typeTokens"
    ? Readonly<Record<string, TypeToken>>
    : GlobalGroup;
}>;

export interface Artboard {
  readonly width: number;
  readonly height: number;
  /**
   * How the artboard's *content* fills the viewport. Not the background media,
   * which is always `cover` and has no fit of its own; this is a guarantee of
   * the model rather than a choice, and absent means contain.
   */
  readonly contentFit?: "contain" | "cover";
  /**
   * The authored canvas's shape. A circle artboard is square and the disc is
   * inscribed in it, so the artboard is the canvas and the corners are masked;
   * it travels with the theme rather than living on the display. Absent means
   * rect.
   */
  readonly shape?: ArtboardShape;
}

/** The two boxes a background media layer can be sized to. Exported because the
 *  validator and the published schema both name this set, and the schema test
 *  holds them to this list rather than to a copy of it. */
export const BACKGROUND_MEDIA_BOUNDS = ["theme", "display"] as const;
export type BackgroundMediaBounds = (typeof BACKGROUND_MEDIA_BOUNDS)[number];

/** The five points a media band can be anchored to inside its bounds box. The
 *  media keeps the full perpendicular axis, so the fill only ever meets it on
 *  one side — or two opposite sides for `center`. */
export const BACKGROUND_ANCHORS = [
  "top",
  "right",
  "bottom",
  "left",
  "center",
] as const;
export type BackgroundAnchor = (typeof BACKGROUND_ANCHORS)[number];

/** The fraction of the box an edge-anchored band keeps. Refused outside this
 *  so a band can neither vanish nor overflow its box; 1 covers the box, and a
 *  fade still softens the seam it leaves. */
export const MIN_BACKGROUND_EXTENT = 0.1;
export const MAX_BACKGROUND_EXTENT = 1;
export const DEFAULT_BACKGROUND_EXTENT = 0.5;

/** A fade is a visibility ramp, so its length is a fraction of the box; a zero
 *  length is the hard edge expressed by omitting it. */
export const MIN_BACKGROUND_FADE = 0.01;
export const MAX_BACKGROUND_FADE = 1;

/** Where the media sits inside its bounds box and how it dissolves into the
 *  fill. A `center` anchor keeps no authored extent: its long edge fits the
 *  box and the aspect decides which axis leaves the two gaps. */
export interface BackgroundMediaComposition {
  readonly anchor?: BackgroundAnchor;
  /** The band's share of the box along the anchored axis; absent means
   *  `DEFAULT_BACKGROUND_EXTENT`. Ignored by `center`. */
  readonly extent?: number;
  /** The ramp at every side the media meets the fill; absent means a hard
   *  edge. Angles, edges and shapes are derived from the anchor, never
   *  authored separately. */
  readonly fade?: number;
}

/** The media's pan, as a fraction of the box's own dimensions. Refused, never
 *  clamped: an offset outside these is an authoring bug, not a reading to round
 *  into range. The placement scales a cover image enough to make the pan
 *  reachable, so the bound is a zoom ceiling rather than a crop limit; ±5
 *  matches the scale range and lets a tall subject be framed inside a short
 *  clip. */
export const MIN_BACKGROUND_OFFSET = -5;
export const MAX_BACKGROUND_OFFSET = 5;

/** The media's zoom over its cover fit, as a fraction: 1 is the cover the
 *  renderer painted before scale existed, 5 is the 500% ceiling an author sees.
 *  Refused outside this range like an offset, never rounded into it. */
export const MIN_BACKGROUND_SCALE = 1;
export const MAX_BACKGROUND_SCALE = 5;

/** The values that reproduce the centred cover the renderer painted before the
 *  media had geometry of its own. Flips default to false, i.e. omitted. */
export const BACKGROUND_MEDIA_DEFAULTS = {
  offsetX: 0,
  offsetY: 0,
  scale: 1,
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
  /** Zoom over the cover fit; absent means 1. The pan stays bounded by the
   *  enlarged rect's overhang, so a zoom cannot uncover the box either. */
  readonly scale?: number;
  /** A paint-time mirror about the placed rect's centre; absent means false. */
  readonly flipX?: boolean;
  readonly flipY?: boolean;
  /**
   * The 0-based frame, at the clip's own frame rate, that stands for this video
   * when motion is unavailable or unhelpful. Written only for a video
   * asset: it is the picture a display without video support shows, and the
   * still the glass material samples instead of a blur per video frame.
   */
  readonly fallbackFrame?: number;
  /** Where the media sits inside its bounds box. Absent covers the whole box. */
  readonly composition?: BackgroundMediaComposition;
}

/** The two background models a theme can be authored under. `simple` is the
 *  full-cover media with a colour behind it; `advanced` adds the composition
 *  (the media's anchored region and fade), and is opted into by a theme that
 *  says so. Absence is `simple`, which is every theme authored before it
 *  existed. */
export const BACKGROUND_MODES = ["simple", "advanced"] as const;
export type BackgroundMode = (typeof BACKGROUND_MODES)[number];

/**
 * The bottom-most layer of the composition.
 *
 * `color` fills the board and the letterbox bars around it — one paint, so the
 * two cannot disagree. It sits behind the media, so it also shows wherever an
 * anchored media region or fade leaves the box uncovered.
 */
export interface Background {
  /** Absent means simple. An advanced background is the only one allowed to
   *  carry the media's `composition`; the validator and the published schema
   *  refuse it under a simple one rather than ignoring it. */
  readonly mode?: BackgroundMode;
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
   * The unit the author wants this reading shown in, where the key can display
   * it. A unit the key cannot display is a plan-time issue, never a load
   * failure: the reading still paints in what was measured.
   */
  readonly unit?: string;
  /** Let the reading pick a magnitude for itself, e.g. GB to TB. */
  readonly autoScale?: boolean;
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
      readonly typeToken: `typeTokens.${string}`;
      readonly style?: StyleMap;
    }
  | {
      readonly kind: "value";
      /** References a binding on the same node. */
      readonly bindingId: string;
      readonly precision?: number;
      readonly unitDisplay?: "none" | "short" | "long";
      readonly typeToken: `typeTokens.${string}`;
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
   * The fixed box, meaningful only on a Text box (`Textbox`). An auto text
   * (`IText`) ignores it; the class is the width-mode owner, not this key.
   */
  readonly box?: TextBox;
  /**
   * What a Text box does with text that outgrows its authored height. An auto
   * text is its own measurement, so it has nothing to clip and ignores this.
   */
  readonly overflow?: "clip" | "ellipsis" | "visible";
  readonly align?: "left" | "center" | "right";
  /** Text box only; an auto text is placed at the top of its measured height. */
  readonly verticalAlign?: "top" | "middle" | "bottom";
}

/** Chart settings stay discriminated by family and share adapter-owned setting types. */
export type ChartContent =
  | { readonly family: "gauge"; readonly settings: GaugeSettings }
  | { readonly family: "line"; readonly settings: LineSettings }
  | { readonly family: "bar"; readonly settings: BarSettings }
  | { readonly family: "pie"; readonly settings: PieSettings }
  | { readonly family: "radar"; readonly settings: RadarSettings }
  | { readonly family: "polarBar"; readonly settings: PolarBarSettings };

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

/** The local file formats a packaged face may be written in. The extension of
 *  a font asset's path must equal its format, so this is also the path's tail. */
export const FONT_ASSET_FORMATS = ["woff2", "woff", "ttf", "otf"] as const;
export type FontAssetFormat = (typeof FONT_ASSET_FORMATS)[number];

export interface FontAssetReference extends AssetReference {
  readonly kind: "font";
  readonly family: string;
  readonly weight: string | number;
  readonly style: "normal" | "italic";
  readonly format: FontAssetFormat;
  /** The published subset this file came from, so registration can attach the
   *  right `unicode-range`. Absent on a locally imported font. */
  readonly subset?: string;
  readonly sourceUrl?: string;
  readonly license?: AssetLicense;
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
   * the runtime's formatting preferences.
   */
  readonly themeLanguage?: string;
  /**
   * Style tags the author picked from the catalogue's vocabulary. The shape and
   * the count are the format's whole rule: membership is unchecked, because a tag
   * the vocabulary does not yet know has to be writable before it can join it, and
   * duplicates are the facet's to collapse.
   */
  readonly tags?: readonly string[];
  /** The catalogue item this theme was remixed from, if any. */
  readonly remixOf?: ThemeRemix;
}

/**
 * The metadata an envelope stores: an emptied field loses its key rather than
 * being written as `""`, and an empty tag list loses `tags`.
 *
 * The envelope validator reads a present empty string as a value, and a theme
 * that declares no tags carries no `tags` key at all — which is the shape the
 * validator and the facet both expect.
 */
export function normalizeThemeMetadata(metadata: ThemeMetadata): ThemeMetadata {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) =>
      Array.isArray(value) ? value.length > 0 : value !== "",
    ),
  ) as ThemeMetadata;
}

/** Why a tag list is not the format's, or `undefined` when it is. */
export function themeTagsRefusal(tags: readonly string[]): string | undefined {
  if (tags.length > MAX_TAGS)
    return `A theme carries at most ${MAX_TAGS} tags.`;
  const seen = new Set<string>();
  for (const tag of tags) {
    if (!TAG_PATTERN.test(tag))
      return `"${tag}" is not a tag this format takes (${TAG_PATTERN.source}).`;
    if (seen.has(tag)) return `"${tag}" is listed twice.`;
    seen.add(tag);
  }
  return undefined;
}

/**
 * The metadata rules, applied to a write before it happens.
 *
 * One owner for both surfaces: the editor's metadata panel drops emptied
 * fields, and the MCP tools write the same shape instead of storing values the
 * panel would never author.
 */
export function themeMetadataRefusal(
  metadata: ThemeMetadata,
): string | undefined {
  if (
    metadata.name !== undefined &&
    new TextEncoder().encode(metadata.name).byteLength > MAX_METADATA_NAME_BYTES
  )
    return `A theme name is at most ${MAX_METADATA_NAME_BYTES} bytes.`;
  return metadata.tags === undefined
    ? undefined
    : themeTagsRefusal(metadata.tags);
}
