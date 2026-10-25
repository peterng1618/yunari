import type { CatalogueEntry } from "@yunari/renderer-core";
import { entryOf, indexDocument, itemFileOf } from "../catalogue/entry.js";
import { countsByItem, favoriteCount } from "../db/favorites.js";
import type { Listing } from "../db/items.js";
import {
  bumpDownloads,
  itemById,
  latestVersion,
  publishedListings,
  versionOf,
} from "../db/items.js";
import type { ItemRow, VersionRow } from "../db/types.js";
import type { Env } from "../env.js";
import { thumbnailKey } from "../storage/keys.js";
import { cancelBody, openObject } from "../storage/objects.js";

const CATALOGUE_PREFIX = "/catalogue/";
const INDEX_WINDOW = "max-age=60";
const THUMBNAIL_WINDOW = "max-age=300";

/**
 * The public half of the store: every route filters `published`, and a hidden
 * or missing item is a 404 rather than a 403 so an id cannot be probed.
 *
 * Returns `undefined` for a path this module does not own, which leaves the
 * Worker's default 404 in place.
 */
export async function handlePublic(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response | undefined> {
  const response = await routePublic(request, env, url);
  if (response === undefined) return undefined;
  // The editor reads the catalogue from the loopback origin, so every public
  // answer — 404s included — has to carry this.
  response.headers.set("access-control-allow-origin", "*");
  return response;
}

async function routePublic(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response | undefined> {
  if (request.method !== "GET") return undefined;
  if (url.pathname === "/index.json") {
    return indexResponse(request, env, url);
  }
  if (!url.pathname.startsWith(CATALOGUE_PREFIX)) return undefined;

  const rest = url.pathname.slice(CATALOGUE_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return undefined;
  const itemId = rest.slice(0, slash);
  const file = rest.slice(slash + 1);

  if (file === "item.json") return itemResponse(env, url, itemId);
  if (file === "thumbnail.png") return thumbnailResponse(env, itemId);
  if (file.endsWith(".zip")) {
    return packageResponse(env, itemId, file.slice(0, -".zip".length));
  }
  return undefined;
}

async function indexResponse(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  // The Cache API answers the 60-second window the response's own header
  // declares, so a repeat request costs no D1 work at all.
  // The DOM lib's `CacheStorage` shadows workers-types', which alone declares
  // `default`; the same cast the store's `timingSafeEqual` call needs.
  const cache = (caches as unknown as { readonly default: Cache }).default;
  const cached = await cache.match(request);
  if (cached !== undefined) {
    // A revalidation only needs the stored ETag; the bytes never change within
    // the window.
    if (request.headers.get("if-none-match") === cached.headers.get("etag")) {
      return new Response(null, { status: 304, headers: cached.headers });
    }
    // A cached response's headers are immutable, and `handlePublic` sets CORS
    // on every answer, so the hit is copied into a fresh response.
    return new Response(cached.body, {
      status: cached.status,
      headers: cached.headers,
    });
  }

  const listings = await publishedListings(env.DB);
  // One count query for the whole listing, not one per entry.
  const counts = await countsByItem(
    env.DB,
    listings.map(({ item }) => item.id),
  );
  const entries: CatalogueEntry[] = [];
  for (const { item, version } of listings) {
    entries.push(
      await entryOfListing(env, url, item, version, counts.get(item.id) ?? 0),
    );
  }
  // `generatedAt` is the newest instant the listing depends on, not the clock:
  // a per-request stamp would change the ETag on every call and no 304 could
  // ever match. An empty listing has nothing to be stable about.
  const body = JSON.stringify(
    indexDocument(entries, generatedAtOf(listings) ?? new Date().toISOString()),
  );
  const etag = await etagOf(body);
  const headers = {
    "cache-control": INDEX_WINDOW,
    etag,
    "content-type": "application/json",
  };
  // The digest is of the exact bytes sent, so a 304 is always safe.
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }
  const response = new Response(body, { headers });
  // The stored copy is the body only; `handlePublic` adds the CORS header on
  // the way out, hit or miss, so it is never cached with it.
  await cache.put(request, response.clone());
  return response;
}

async function itemResponse(
  env: Env,
  url: URL,
  itemId: string,
): Promise<Response> {
  const item = await itemById(env.DB, itemId);
  if (item === undefined || item.status !== "published") return notFound();
  const version = await latestVersion(env.DB, item.id);
  if (version === undefined) return notFound();
  // One item is one query, so the batched map would be ceremony here.
  const entry = await entryOfListing(
    env,
    url,
    item,
    version,
    await favoriteCount(env.DB, item.id),
  );
  // The id is redundant with the directory name but is what a caller that
  // fetched this file by id already holds; `facets` stays the index's.
  const body = JSON.stringify({ id: item.id, ...itemFileOf(entry) });
  return new Response(body, {
    headers: {
      "cache-control": INDEX_WINDOW,
      "content-type": "application/json",
    },
  });
}

async function thumbnailResponse(env: Env, itemId: string): Promise<Response> {
  const item = await itemById(env.DB, itemId);
  if (item === undefined || item.status !== "published") return notFound();
  const object = await openObject(env.BUCKET, thumbnailKey(itemId));
  if (object === undefined) return notFound();
  return new Response(object.body, {
    headers: {
      "cache-control": THUMBNAIL_WINDOW,
      "content-type": "image/png",
    },
  });
}

async function packageResponse(
  env: Env,
  itemId: string,
  version: string,
): Promise<Response> {
  const row = await versionOf(env.DB, itemId, version);
  if (row === undefined) return notFound();
  const object = await openObject(env.BUCKET, row.package_key);
  if (object === undefined) return notFound();
  // Counted before the body streams: whether the transfer completes is not
  // observable after the response is handed back. The update's own status
  // predicate cancels a body whose item stopped being published.
  if (!(await bumpDownloads(env.DB, itemId))) {
    await cancelBody(object);
    return notFound();
  }
  return new Response(object.body, {
    headers: {
      // A cache hit would skip the counter.
      "cache-control": "no-store",
      "content-type": "application/zip",
    },
  });
}

async function entryOfListing(
  env: Env,
  url: URL,
  item: ItemRow,
  version: VersionRow,
  favorites: number,
): Promise<CatalogueEntry> {
  return entryOf(
    item,
    version,
    favorites,
    `${url.origin}/catalogue/${item.id}/${version.version}.zip`,
    `catalogue/${item.id}/thumbnail.png`,
  );
}

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

/** The listing's own clock: every instant a row in it was last touched. */
function generatedAtOf(listings: readonly Listing[]): string | undefined {
  let newest: string | undefined;
  for (const { item, version } of listings) {
    for (const instant of [item.updated_at, version.created_at]) {
      if (newest === undefined || instant > newest) newest = instant;
    }
  }
  return newest;
}

async function etagOf(body: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(body),
  );
  return `"${hex(new Uint8Array(digest))}"`;
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
