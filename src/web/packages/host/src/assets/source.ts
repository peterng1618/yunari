import type {
  AssetResult,
  FontCut,
  ListingCategory,
  PresetKind,
} from "@yunari/renderer-core";

/**
 * The asset source port.
 *
 * Every provider call is the host's: the browser holds no key and calls no
 * provider, and a source receives a credential only through this context, never
 * through a request body.
 */
export interface SourceContext {
  /** Never leaves the host. */
  readonly credential: (id: string) => string | undefined;
  readonly signal: AbortSignal;
  readonly fetch: typeof fetch;
}

export interface SourceBytes {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly filename: string;
}

export interface SearchPage {
  readonly results: readonly AssetResult[];
  /** How many pages this question has for this source, or undefined when the
   *  source cannot say. The pager draws no numeral without it. */
  readonly totalPages: number | undefined;
}

export interface AssetSource {
  readonly id: string;
  readonly label: string;
  readonly category: ListingCategory;
  /** "grid" searches; "font-picker" and "wallpaper-engine" are editor bodies. */
  readonly body: "grid" | "font-picker" | "wallpaper-engine";
  readonly requires: string | undefined;
  readonly configurable: boolean;
  /** The kind of preset this source yields; absent when it yields none. */
  readonly presetKind?: PresetKind;
  /** The host a search term reaches, or null when it stays on this PC. */
  readonly host?: string | null;
  search(
    query: string,
    /** 1-based; the host asks for the page the pager shows. */
    page: number,
    ctx: SourceContext,
  ): Promise<SearchPage>;
  bytesOf(
    resultId: string,
    ctx: SourceContext,
  ): Promise<SourceBytes | undefined>;
  /**
   * Every cut a family publishes, when this source can enumerate them. A trio
   * result carries only its three role cuts, so import asks by family instead:
   * sending every family's cuts inside each of 379 results is the duplication
   * this port avoids. Absent means the source cannot answer, and the caller
   * falls back to the cuts it already has.
   */
  familyCuts?(family: string): readonly FontCut[] | undefined;
}
