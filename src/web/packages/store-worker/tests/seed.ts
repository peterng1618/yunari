import { env, SELF } from "cloudflare:test";
import type {
  CatalogueIndex,
  CatalogueStatus,
  FacetRecord,
} from "@yunari/renderer-core";
import { pendingKey, thumbnailKey } from "../src/storage/keys";
import { BASE } from "./base";

/** Fixed ids and bytes so a spec can name what it seeded without a second read. */
export const ITEM_ID = "6041df49-9c61-4d51-a184-716890560bdb";
export const PACKAGE_BYTES = new TextEncoder().encode("yunari test package");
/** The one key `/index.json` is cached under, whatever the request URL. */
const INDEX_URL = `${BASE}/index.json`;

/**
 * Where a seeded version's bytes live. A real package is never re-keyed after
 * the upload, so the only key a fixture may use is the pending shape — a
 * `packages/<id>/<version>.zip` fixture would test a key no writer writes.
 */
export function fixturePackageKey(itemId: string, version: string): string {
  return pendingKey(`seed-${itemId}-${version}`);
}

const CREATED_AT = "2026-10-01T00:00:00.000Z";
const FACETS: FacetRecord = {
  author: "Huy",
  colourMode: "dark",
  sensors: [{ key: "cpu.usage", label: "CPU", family: "cpu" }],
  tags: ["minimal"],
  orientation: "landscape",
  aspect: "16:9",
  width: 1280,
  height: 720,
};
const ENVELOPE_JSON = JSON.stringify({ schemaVersion: "2.0.0", metadata: {} });

export interface SeedOptions {
  readonly versions?: readonly string[];
  readonly downloads?: number;
  readonly favorites?: number;
  readonly owner?: string;
  readonly status?: CatalogueStatus;
}

/**
 * One item row, its versions, their package objects and its thumbnail.
 *
 * `status` is written as given, because every public read's test needs an item
 * that holds its rows and objects but must not answer — the unpublish shape.
 */
export async function seedPublished(options: SeedOptions = {}): Promise<void> {
  const versions = options.versions ?? ["1.0.0"];
  const status = options.status ?? "published";
  const favorites = options.favorites ?? 0;

  // The pool keeps D1 rows and R2 objects between tests in one file, so the
  // helper clears its own fixed id rather than relying on isolated storage.
  await env.DB.prepare("DELETE FROM item WHERE id = ?").bind(ITEM_ID).run();
  await env.DB.prepare("DELETE FROM item_version WHERE item_id = ?")
    .bind(ITEM_ID)
    .run();
  await env.DB.prepare("DELETE FROM favorite WHERE item_id = ?")
    .bind(ITEM_ID)
    .run();

  await env.DB.prepare(
    `INSERT INTO item (id, kind, author_user_id, name, status, status_reason,
       created_at, updated_at, published_at, unpublished_at, removed_at,
       downloads, remix_of_id)
     VALUES (?, 'dashboard-theme', ?, 'Yunari smoke theme', ?, NULL, ?, ?, ?, NULL, NULL, ?, NULL)`,
  )
    .bind(
      ITEM_ID,
      options.owner ?? "user-author",
      status,
      CREATED_AT,
      CREATED_AT,
      status === "published" ? CREATED_AT : null,
      options.downloads ?? 0,
    )
    .run();

  for (const [index, version] of versions.entries()) {
    await env.DB.prepare(
      `INSERT INTO item_version (item_id, version, envelope_json, facets_json,
         package_key, thumbnail_key, bytes, sha256, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        ITEM_ID,
        version,
        ENVELOPE_JSON,
        JSON.stringify(FACETS),
        fixturePackageKey(ITEM_ID, version),
        thumbnailKey(ITEM_ID),
        PACKAGE_BYTES.byteLength,
        "0".repeat(64),
        versionInstant(index),
      )
      .run();
    await putPackage(fixturePackageKey(ITEM_ID, version), PACKAGE_BYTES);
  }

  await env.BUCKET.put(thumbnailKey(ITEM_ID), PNG_BYTES);

  for (let index = 0; index < favorites; index += 1) {
    await env.DB.prepare(
      "INSERT INTO favorite (user_id, item_id, created_at) VALUES (?, ?, ?)",
    )
      .bind(`favorite-${index}`, ITEM_ID, CREATED_AT)
      .run();
  }
}

/**
 * One item row and nothing else — no version, no objects. That is the shape a
 * presign leaves between the version request and the finalize supposed to
 * follow it, and it is what the quota and ownership tests need.
 */
export async function seedItem(
  id: string,
  owner: string,
  options: {
    readonly status?: CatalogueStatus;
    readonly statusReason?: string;
  } = {},
): Promise<void> {
  await env.DB.prepare("DELETE FROM item_version WHERE item_id = ?")
    .bind(id)
    .run();
  await env.DB.prepare("DELETE FROM item WHERE id = ?").bind(id).run();
  await env.DB.prepare(
    `INSERT INTO item (id, kind, author_user_id, name, status, status_reason,
       created_at, updated_at, published_at, unpublished_at, removed_at,
       downloads, remix_of_id)
     VALUES (?, 'dashboard-theme', ?, 'Seeded theme', ?, ?, ?, ?, NULL, NULL,
       NULL, 0, NULL)`,
  )
    .bind(
      id,
      owner,
      options.status ?? "draft",
      options.statusReason ?? null,
      CREATED_AT,
      CREATED_AT,
    )
    .run();
}

/**
 * One item in a named state with a single version row, owned by `owner`.
 *
 * `seedItem` stops at the row, which is a presign leftover; a listing of the
 * author's own items needs the states an item reaches after a finalize, and
 * `seedPublished` only owns the fixed `ITEM_ID`.
 */
export async function seedStatus(options: {
  readonly id: string;
  readonly owner: string;
  readonly status: CatalogueStatus;
  readonly statusReason?: string;
  /** Defaults to the seed instant, so a spec picks the listing's order. */
  readonly updatedAt?: string;
}): Promise<void> {
  const updatedAt = options.updatedAt ?? CREATED_AT;

  await env.DB.prepare("DELETE FROM item_version WHERE item_id = ?")
    .bind(options.id)
    .run();
  await env.DB.prepare("DELETE FROM favorite WHERE item_id = ?")
    .bind(options.id)
    .run();
  await env.DB.prepare("DELETE FROM item WHERE id = ?").bind(options.id).run();

  await env.DB.prepare(
    `INSERT INTO item (id, kind, author_user_id, name, status, status_reason,
       created_at, updated_at, published_at, unpublished_at, removed_at,
       downloads, remix_of_id)
     VALUES (?, 'dashboard-theme', ?, 'Seeded theme', ?, ?, ?, ?, NULL, NULL,
       NULL, 0, NULL)`,
  )
    .bind(
      options.id,
      options.owner,
      options.status,
      options.statusReason ?? null,
      CREATED_AT,
      updatedAt,
    )
    .run();

  await env.DB.prepare(
    `INSERT INTO item_version (item_id, version, envelope_json, facets_json,
       package_key, thumbnail_key, bytes, sha256, created_at)
     VALUES (?, '1.0.0', ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      options.id,
      ENVELOPE_JSON,
      JSON.stringify(FACETS),
      fixturePackageKey(options.id, "1.0.0"),
      thumbnailKey(options.id),
      PACKAGE_BYTES.byteLength,
      "0".repeat(64),
      versionInstant(0),
    )
    .run();
}

/**
 * `count` versionless items owned by one account. The first is `ITEM_ID`, so a
 * spec can name it after seeding; the rest are valid catalogue ids of their own.
 * The owner's rows are cleared first, because the pool keeps D1 rows between
 * tests in a file.
 */
export async function seedItems(options: {
  readonly userId: string;
  readonly count: number;
}): Promise<readonly string[]> {
  await env.DB.prepare(
    "DELETE FROM item_version WHERE item_id IN (SELECT id FROM item WHERE author_user_id = ?)",
  )
    .bind(options.userId)
    .run();
  await env.DB.prepare("DELETE FROM item WHERE author_user_id = ?")
    .bind(options.userId)
    .run();

  const ids: string[] = [];
  for (let index = 0; index < options.count; index += 1) {
    const id =
      index === 0
        ? ITEM_ID
        : `10000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
    await seedItem(id, options.userId);
    ids.push(id);
  }
  return ids;
}

/**
 * Presign rows for the rate-limit test. `envelope_json` is a placeholder: the
 * count is what `presignAllowed` reads, and nothing parses these rows.
 */
export async function seedPresigns(options: {
  readonly userId: string;
  readonly count: number;
  readonly withinHour: boolean;
}): Promise<void> {
  await env.DB.prepare("DELETE FROM presign_event WHERE user_id = ?")
    .bind(options.userId)
    .run();
  const at = new Date(
    Date.now() - (options.withinHour ? 60_000 : 2 * 60 * 60 * 1000),
  );
  for (let index = 0; index < options.count; index += 1) {
    await env.DB.prepare(
      `INSERT INTO presign_event (user_id, at, item_id, version, envelope_json)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(options.userId, at.toISOString(), ITEM_ID, "1.0.0", "{}")
      .run();
  }
}

export async function putPackage(
  key: string,
  bytes: Uint8Array,
): Promise<void> {
  await env.BUCKET.put(key, bytes);
}

export async function downloads(
  db: D1Database,
  itemId: string,
): Promise<number> {
  const row = await db
    .prepare("SELECT downloads FROM item WHERE id = ?")
    .bind(itemId)
    .first<{ downloads: number }>();
  return row?.downloads ?? 0;
}

export async function versionsOf(
  db: D1Database,
  itemId: string,
): Promise<readonly string[]> {
  const rows = await db
    .prepare(
      "SELECT version FROM item_version WHERE item_id = ? ORDER BY created_at",
    )
    .bind(itemId)
    .all<{ version: string }>();
  return rows.results.map((row) => row.version);
}

export async function statusOf(
  db: D1Database,
  itemId: string,
): Promise<CatalogueStatus | undefined> {
  const row = await db
    .prepare("SELECT status FROM item WHERE id = ?")
    .bind(itemId)
    .first<{ status: CatalogueStatus }>();
  return row?.status;
}

/** The listing's ids as the editor receives them, not as D1 stores them. */
export async function indexIds(): Promise<readonly string[]> {
  await clearIndexCache();
  const response = await SELF.fetch(INDEX_URL);
  const index = (await response.json()) as CatalogueIndex;
  return index.entries.map((entry) => entry.id);
}

/**
 * Drops the stored `/index.json`. The route caches it for 60 seconds and the
 * pool keeps the cache between tests in one file, so a spec that changes what
 * the index lists must clear it before reading.
 */
export async function clearIndexCache(): Promise<void> {
  // The DOM lib's `CacheStorage` shadows workers-types', which declares
  // `default`; this is the same cast `public.ts` needs.
  const cache = (caches as unknown as { readonly default: Cache }).default;
  await cache.delete(new Request(INDEX_URL));
}

/** Later versions are inserted later, so `created_at` orders the ladder. */
function versionInstant(index: number): string {
  return new Date(Date.UTC(2026, 9, 1, 0, 0, index)).toISOString();
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
