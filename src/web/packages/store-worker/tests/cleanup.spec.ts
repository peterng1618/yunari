import { env } from "cloudflare:test";
import { MAX_ARCHIVE_BYTES } from "@yunari/theme-package";
import { describe, expect, it } from "vitest";
import { pendingBytes, UPLOAD_RESERVATION_TTL_MS } from "../src/db/quota";
import { cleanupPending } from "../src/storage/cleanup";
import { pendingKey } from "../src/storage/keys";

/**
 * `now` is injected, so these cases drive the cutoffs instead of waiting for
 * them. A far-future instant keeps the seeded rows' ISOs readable.
 */
const NOW = new Date("2030-01-01T00:00:00.000Z");
const HOUR_MS = UPLOAD_RESERVATION_TTL_MS;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const AUTHOR = "cleanup-author";
const ITEM_ID = "cleanup-item";
const PACKAGE_BYTES = new TextEncoder().encode("cleanup package");

describe("cleanupPending", () => {
  it("deletes an expired reservation's object but keeps its row", async () => {
    await reset();
    const key = await seedUpload({
      id: "cleanup-expired",
      createdAt: instant(-HOUR_MS - 1000),
    });

    expect(await cleanupPending(env, NOW)).toEqual({
      deletedObjects: 1,
      deletedRows: 0,
    });
    expect(await env.BUCKET.head(key)).toBeNull();
    expect(await rowExists("cleanup-expired")).toBe(true);
    // The reservation expired and its object is gone at the same instant.
    expect(await pendingBytes(env.DB, AUTHOR, NOW)).toBe(0);
  });

  it("keeps a finalized row and its object past the hour", async () => {
    await reset();
    const key = await seedUpload({
      id: "cleanup-finalized",
      createdAt: instant(-HOUR_MS - 1000),
      finalizedAt: instant(-HOUR_MS - 1000),
    });

    expect(await cleanupPending(env, NOW)).toEqual({
      deletedObjects: 0,
      deletedRows: 0,
    });
    expect(await env.BUCKET.head(key)).not.toBeNull();
    expect(await rowExists("cleanup-finalized")).toBe(true);
  });

  it("leaves a reservation younger than the hour alone", async () => {
    await reset();
    const key = await seedUpload({
      id: "cleanup-live",
      createdAt: instant(-HOUR_MS + 1000),
    });

    expect(await cleanupPending(env, NOW)).toEqual({
      deletedObjects: 0,
      deletedRows: 0,
    });
    expect(await env.BUCKET.head(key)).not.toBeNull();
    expect(await rowExists("cleanup-live")).toBe(true);
  });

  it("deletes an old object before pruning its row", async () => {
    await reset();
    const unfinalizedKey = await seedUpload({
      id: "cleanup-week-unfinalized",
      createdAt: instant(-WEEK_MS - 1000),
    });
    const finalizedKey = await seedUpload({
      id: "cleanup-week-finalized",
      createdAt: instant(-WEEK_MS - 1000),
      finalizedAt: instant(-WEEK_MS - 1000),
    });

    expect(await cleanupPending(env, NOW)).toEqual({
      deletedObjects: 1,
      deletedRows: 2,
    });
    expect(await env.BUCKET.head(unfinalizedKey)).toBeNull();
    // A finalized row's object is a live package named by its version; only the
    // row is pruned.
    expect(await env.BUCKET.head(finalizedKey)).not.toBeNull();
    expect(await rowExists("cleanup-week-unfinalized")).toBe(false);
    expect(await rowExists("cleanup-week-finalized")).toBe(false);
  });

  it("keeps an object a stored version names", async () => {
    await reset();
    const key = await seedUpload({
      id: "cleanup-guard",
      createdAt: instant(-HOUR_MS - 1000),
    });
    await env.DB.prepare(
      `INSERT INTO item_version (item_id, version, envelope_json, facets_json,
         package_key, thumbnail_key, bytes, sha256, created_at)
       VALUES (?, '1.0.0', '{}', '{}', ?, 'thumbnails/cleanup.png', ?, ?, ?)`,
    )
      .bind(
        ITEM_ID,
        key,
        PACKAGE_BYTES.byteLength,
        "0".repeat(64),
        instant(-HOUR_MS - 1000),
      )
      .run();

    expect(await cleanupPending(env, NOW)).toEqual({
      deletedObjects: 0,
      deletedRows: 0,
    });
    expect(await env.BUCKET.head(key)).not.toBeNull();
    expect(await rowExists("cleanup-guard")).toBe(true);
  });

  it("is a no-op on a second run", async () => {
    await reset();
    await seedUpload({
      id: "cleanup-idempotent",
      createdAt: instant(-WEEK_MS - 1000),
    });

    expect(await cleanupPending(env, NOW)).toEqual({
      deletedObjects: 1,
      deletedRows: 1,
    });
    expect(await cleanupPending(env, NOW)).toEqual({
      deletedObjects: 0,
      deletedRows: 0,
    });
  });
});

/** This file's rows and objects only; the pool keeps storage between cases. */
async function reset(): Promise<void> {
  const rows = await env.DB.prepare("SELECT key FROM upload").all<{
    key: string;
  }>();
  const keys = rows.results.map((row) => row.key);
  if (keys.length > 0) await env.BUCKET.delete(keys);
  await env.DB.prepare("DELETE FROM upload").run();
  await env.DB.prepare("DELETE FROM item_version WHERE item_id = ?")
    .bind(ITEM_ID)
    .run();
}

/** An instant `offsetMs` from the injected `now`. */
function instant(offsetMs: number): string {
  return new Date(NOW.getTime() + offsetMs).toISOString();
}

/** One reservation row and the pending object its key names. */
async function seedUpload(options: {
  readonly id: string;
  readonly createdAt: string;
  readonly finalizedAt?: string;
}): Promise<string> {
  const key = pendingKey(options.id);
  await env.DB.prepare(
    `INSERT INTO upload (id, user_id, item_id, version, envelope_json, key,
       reserved_bytes, created_at, finalized_at, bytes)
     VALUES (?, ?, ?, '1.0.0', '{}', ?, ?, ?, ?, ?)`,
  )
    .bind(
      options.id,
      AUTHOR,
      ITEM_ID,
      key,
      MAX_ARCHIVE_BYTES,
      options.createdAt,
      options.finalizedAt ?? null,
      options.finalizedAt === undefined ? null : PACKAGE_BYTES.byteLength,
    )
    .run();
  await env.BUCKET.put(key, PACKAGE_BYTES);
  return key;
}

async function rowExists(id: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT id FROM upload WHERE id = ?")
    .bind(id)
    .first<{ id: string }>();
  return row !== null;
}
