import type { CatalogueStatus } from "@yunari/renderer-core";

/**
 * The `item` table's columns, one field per column and no mapping layer: a D1
 * row and this type are the same shape, so a query's `.all()` result can be
 * handed straight to a projection.
 */
export interface ItemRow {
  readonly id: string;
  readonly kind: string;
  readonly author_user_id: string;
  readonly name: string;
  readonly status: CatalogueStatus;
  readonly status_reason: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly published_at: string | null;
  readonly unpublished_at: string | null;
  readonly removed_at: string | null;
  readonly downloads: number;
  readonly remix_of_id: string | null;
}

/** The `item_version` table's columns, as `item`'s: snake_case, one per column. */
export interface VersionRow {
  readonly item_id: string;
  readonly version: string;
  /** The validated `theme.json`; the version ladder's baseline. */
  readonly envelope_json: string;
  /** `facetRecordOf(envelope)`, derived once when the version is written. */
  readonly facets_json: string;
  readonly package_key: string;
  readonly thumbnail_key: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly created_at: string;
}

/**
 * The `upload` table's columns: a proxied upload's reservation. `finalized_at`
 * and `bytes` are set together, so they are nullable together.
 */
export interface UploadRow {
  readonly id: string;
  readonly user_id: string;
  readonly item_id: string;
  readonly version: string;
  readonly envelope_json: string;
  /** Where the pending object lives; finalize copies it into `package_key`. */
  readonly key: string;
  readonly reserved_bytes: number;
  readonly created_at: string;
  readonly finalized_at: string | null;
  readonly bytes: number | null;
}
