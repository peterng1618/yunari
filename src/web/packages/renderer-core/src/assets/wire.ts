/** The asset finder's wire contract, spoken by the host and the editor. */

/** What an asset becomes when the finder adds it to the presets: a palette's
 *  own colours, or a gradient's angle and stops. */
export type PresetKind = "palette" | "gradient";

export type AssetPreset =
  | { readonly kind: "palette"; readonly colours: readonly string[] }
  | {
      readonly kind: "gradient";
      readonly angle: number;
      readonly stops: readonly {
        readonly offset: number;
        readonly color: string;
      }[];
    };

export type SourceCategory = "font" | "icon" | "image" | "video" | "colour";

/** Deliberately not the persisted `FontAssetFormat`: a host may learn a format
 *  the schema still refuses, so the wire can widen without the file following. */
export type FontFormat = "woff2" | "woff" | "ttf" | "otf";

/** One font file a family offers, with what a picker needs to show and fetch it. */
export interface FontCut {
  readonly id: string;
  readonly source: string;
  readonly family: string;
  readonly weight: string | number;
  readonly style: "normal" | "italic";
  readonly subset: string;
  readonly format: FontFormat;
  readonly previewUrl: string;
  readonly licence: string;
  readonly sourceUrl?: string;
}

/** A family's heading, body and mono cuts, when the source names them. */
export interface FontTrioInfo {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly roles: Readonly<
    Partial<Record<"heading" | "body" | "mono", FontCut>>
  >;
}

/** `"local"` is a category no grid draws: it names a source that is a library
 *  on this PC rather than a provider, which is only Wallpaper Engine (R8). */
export type ListingCategory = SourceCategory | "local";

export interface AssetResult {
  /** The source's own id; the host prefixes it. */
  readonly id: string;
  readonly name: string;
  /** The credits entry's kind. The source's own word for what it serves, so
   *  attribution at import does not have to guess from a file extension. */
  readonly kind: string;
  /** A URL the editor may render, or "". */
  readonly preview: string;
  readonly subtitle: string | undefined;
  /** "unknown" rather than "". */
  readonly licence: string;
  readonly sourceUrl: string;
  /** What adding this asset to the presets writes, when its source says. */
  readonly preset?: AssetPreset;
  /** A font source's cuts, and its trio when it names one. */
  readonly font?: {
    readonly cuts: readonly FontCut[];
    readonly trio?: FontTrioInfo;
  };
}

export interface AssetSourceListing {
  readonly id: string;
  readonly label: string;
  readonly category: ListingCategory;
  /** "grid" searches; "font-picker" and "wallpaper-engine" are editor bodies. */
  readonly body: "grid" | "font-picker" | "wallpaper-engine";
  /** `null` on the wire when the source needs no credential. */
  readonly requires: string | null;
  readonly configurable: boolean;
  /** The kind of preset this source yields, or `null` when it yields none. */
  readonly presetKind: PresetKind | null;
  /** The host a search term is sent to, named by the first-search notice.
   *  `null` when the term never leaves this computer. */
  readonly host: string | null;
}

export interface AssetSearchRequest {
  readonly query: string;
  readonly enabled: readonly string[];
  /** The page each source is asked for, 1-based. Absent means page 1, which is
   *  the question a freshly opened grid asks. */
  readonly pages: Readonly<Record<string, number>>;
  /** Which editor body asks. Absent means "grid". */
  readonly body?: "grid" | "font-picker";
}

export interface AssetPage {
  readonly source: string;
  /** Ids already prefixed "<source>:<id>". */
  readonly results: readonly AssetResult[];
  /** How many pages this source has for this question, or undefined when it
   *  cannot say (a failure, or a source that does not page). */
  readonly totalPages: number | undefined;
  readonly failure:
    | { readonly reason: "failed"; readonly message: string }
    | { readonly reason: "needs-credential"; readonly credential: string }
    | undefined;
}

export interface AssetSearchAnswer {
  readonly pages: readonly AssetPage[];
}

/** What `GET /api/credentials` answers. Never carries the value. */
export interface CredentialRow {
  readonly id: string;
  readonly label: string;
  readonly set: boolean;
  /** The last four characters, or "" when unset. */
  readonly hint: string;
  /** Whether this host has a check to run, which is what enables Verify. */
  readonly verify: boolean;
  /** One sentence naming where the key comes from, or null when there is none. */
  readonly helpText: string | null;
  /** Where a person creates the key, or null when there is none. */
  readonly helpUrl: string | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A search body, kept to the sources this host knows.
 *
 * A stale browser preference is not a reason to fail a search: an unknown id is
 * dropped, so a disabled or removed source simply contributes no page.
 */
export function parseAssetSearchRequest(
  value: unknown,
  known: readonly string[],
): AssetSearchRequest | undefined {
  if (!isObject(value)) return undefined;

  const { query, enabled, pages } = value;

  if (typeof query !== "string" || !Array.isArray(enabled)) return undefined;

  const knownIds = new Set(known);
  const enabledIds = enabled.filter(
    (id): id is string => typeof id === "string" && knownIds.has(id),
  );

  const parsedPages: [string, number][] = [];
  if (isObject(pages)) {
    for (const [id, page] of Object.entries(pages)) {
      // A page is a whole number from one: a fraction, a zero or a negative is
      // not a page any source can answer, so it asks page one rather than
      // being coerced into a question nobody made.
      if (typeof page === "number" && Number.isInteger(page) && page >= 1) {
        parsedPages.push([id, page]);
      }
    }
  }

  // `fromEntries` rather than assignment: `__proto__` is a legal source id and
  // assignment would reach the map's prototype instead of storing the page.
  // A body this host does not name falls back to the grid, as an unknown
  // source id does: a stale preference is not a failed search.
  const body = value.body === "font-picker" ? "font-picker" : undefined;
  return {
    query,
    enabled: enabledIds,
    pages: Object.fromEntries(parsedPages),
    ...(body === undefined ? {} : { body }),
  };
}
