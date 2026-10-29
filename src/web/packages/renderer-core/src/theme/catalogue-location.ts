/**
 * Where the store's public files are served from, owned once.
 *
 * The Worker is the only origin: the catalogue index, an item's JSON, its
 * package and its picture are paths on it. Changing where the store lives is
 * one edit here rather than a search.
 */

export const CATALOGUE_ORIGIN = "https://yunari-store.workers.dev";

/** The storefront listing the browser reads. */
export function catalogueIndexUrl(): string {
  return `${CATALOGUE_ORIGIN}/index.json`;
}

/** One item's JSON: version, facets and the version this item holds. */
export function catalogueItemUrl(id: string): string {
  return `${CATALOGUE_ORIGIN}/catalogue/${id}/item.json`;
}

/** One version's package. The Worker serves a path per version, not one zip per
 *  item. */
export function cataloguePackageUrl(id: string, version: string): string {
  return `${CATALOGUE_ORIGIN}/catalogue/${id}/${version}.zip`;
}

/** An item's picture. The entry's `thumbnail` is a path inside the store, and a
 *  leading slash would double the separator the origin already holds. */
export function catalogueThumbnailUrl(path: string): string {
  return `${CATALOGUE_ORIGIN}/${path.replace(/^\/+/, "")}`;
}
