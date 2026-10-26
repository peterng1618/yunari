import { env } from "cloudflare:test";
import { MAX_ARCHIVE_BYTES } from "@yunari/theme-package";
import { describe, expect, it } from "vitest";
import { pendingBytes, UPLOAD_RESERVATION_TTL_MS } from "../src/db/quota";
import type { Env } from "../src/env";
import {
  cleanupPending,
  EXPIRED_DELETE_GRACE_MS,
} from "../src/storage/cleanup";
import { pendingKey } from "../src/storage/keys";

/**
 * `now` is injected, so these cases drive the cutoffs instead of waiting for
 * them. A far-future instant keeps the seeded rows' ISOs readable.
 */
const NOW = new Date("2030-01-01T00:00:00.000Z");
const HOUR_MS = UPLOAD_RESERVATION_TTL_MS;
/** The delete cutoff: the reservation's hour plus one schedule tick. */
const DELETE_AFTER_MS = HOUR_MS + EXPIRED_DELETE_GRACE_MS;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const AUTHOR = "cleanup-author";
const ITEM_ID = "cleanup-item";
const PACKAGE_BYTES = new TextEncoder().encode("cleanup package");

describe("cleanupPending", () => {
  it("deletes an expired reservation's object but keeps its row", async () => {
    await reset();
    const key = await seedUpload({
      id: "cleanup-expired",
      createdAt: instant(-DELETE_AFTER_MS - 1000),
    });

    expect(await cleanupPending(env, NOW)).toEqual({
      deletedObjects: 1,
      deletedRows: 0,
    });
    expect(await env.BUCKET.head(key)).toBeNull();
    expect(await rowExists("cleanup-expired")).toBe(true);
    // The reservation expired and the object is gone by the same run.
    expect(await pendingBytes(env.DB, AUTHOR, NOW)).toBe(0);
  });

  it("keeps a finalized row and its object past the cutoff", async () => {
    await reset();
    const key = await seedUpload({
      id: "cleanup-finalized",
      createdAt: instant(-DELETE_AFTER_MS - 1000),
      finalizedAt: instant(-DELETE_AFTER_MS - 1000),
    });

    expect(await cleanupPending(env, NOW)).toEqual({
      deletedObjects: 0,
      deletedRows: 0,
    });
    expect(await env.BUCKET.head(key)).not.toBeNull();
    expect(await rowExists("cleanup-finalized")).toBe(true);
  });

  it("keeps an object one minute past the reservation's hour", async () => {
    await reset();
    const key = await seedUpload({
      id: "cleanup-grace",
      createdAt: instant(-HOUR_MS - 60_000),
    });

    expect(await cleanupPending(env, NOW)).toEqual({
      deletedObjects: 0,
      deletedRows: 0,
    });
    expect(await env.BUCKET.head(key)).not.toBeNull();
    expect(await rowExists("cleanup-grace")).toBe(true);
  });

  it("deletes that object at the hour plus one schedule tick", async () => {
    await reset();
    const key = await seedUpload({
      id: "cleanup-grace-over",
      createdAt: instant(-DELETE_AFTER_MS),
    });

    expect(await cleanupPending(env, NOW)).toEqual({
      deletedObjects: 1,
      deletedRows: 0,
    });
    expect(await env.BUCKET.head(key)).toBeNull();
    expect(await rowExists("cleanup-grace-over")).toBe(true);
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
      createdAt: instant(-DELETE_AFTER_MS - 1000),
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
        instant(-DELETE_AFTER_MS - 1000),
      )
      .run();

    expect(await cleanupPending(env, NOW)).toEqual({
      deletedObjects: 0,
      deletedRows: 0,
    });
    expect(await env.BUCKET.head(key)).not.toBeNull();
    expect(await rowExists("cleanup-guard")).toBe(true);
  });

  it("deletes past R2's 1000-key cap in slices, then still prunes", async () => {
    await reset();
    const keys = await seedManyExpired(1001);
    // Finalized, so the expired select does not pick it; only the prune can.
    await seedUpload({
      id: "cleanup-cap-pruned",
      createdAt: instant(-WEEK_MS - 1000),
      finalizedAt: instant(-WEEK_MS - 1000),
    });

    const calls: string[][] = [];
    const bucket = {
      delete: async (target: string | string[]) => {
        const list = typeof target === "string" ? [target] : target;
        calls.push(list);
        // The real cap: without slicing the first call throws and the prune
        // never runs, wedging every later run.
        if (list.length > 1000)
          throw new Error("R2 delete accepts at most 1000 keys");
        await env.BUCKET.delete(target);
      },
    } as unknown as R2Bucket;
    const capped = { DB: env.DB, BUCKET: bucket } as unknown as Env;

    expect(await cleanupPending(capped, NOW)).toEqual({
      deletedObjects: 1001,
      deletedRows: 1,
    });
    expect(calls.every((call) => call.length <= 1000)).toBe(true);
    expect(new Set(calls.flat())).toEqual(new Set(keys));
    expect(await rowExists("cleanup-cap-pruned")).toBe(false);
  });

  it("does not re-select a row the prune removed", async () => {
    await reset();
    await seedUpload({
      id: "cleanup-pruned",
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

  it("reports a retained expired row again, with its object still absent", async () => {
    await reset();
    const key = await seedUpload({
      id: "cleanup-retained",
      // Past the delete cutoff but younger than the seven-day prune.
      createdAt: instant(-DELETE_AFTER_MS - 1000),
    });

    expect(await cleanupPending(env, NOW)).toEqual({
      deletedObjects: 1,
      deletedRows: 0,
    });
    // The row is kept for its seven days, so a later run asks R2 again; a delete
    // of a missing key is not a failure.
    expect(await cleanupPending(env, NOW)).toEqual({
      deletedObjects: 1,
      deletedRows: 0,
    });
    expect(await env.BUCKET.head(key)).toBeNull();
    expect(await rowExists("cleanup-retained")).toBe(true);
  });
});

/** This file's rows and objects only; the pool keeps storage between cases. */
async function reset(): Promise<void> {
  const rows = await env.DB.prepare("SELECT key FROM upload").all<{
    key: string;
  }>();
  const keys = rows.results.map((row) => row.key);
  // Sliced: this cleanup helper is subject to the same R2 cap as the code.
  for (let index = 0; index < keys.length; index += 1000)
    await env.BUCKET.delete(keys.slice(index, index + 1000));
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

/**
 * `count` expired reservations with no objects: the delete accepts a missing
 * key, and the chunking case asserts the keys it was asked to delete.
 */
async function seedManyExpired(count: number): Promise<string[]> {
  const ids = Array.from(
    { length: count },
    (_, index) => `cleanup-many-${index}`,
  );
  const createdAt = instant(-DELETE_AFTER_MS - 1000);
  for (let start = 0; start < ids.length; start += 50) {
    await env.DB.batch(
      ids.slice(start, start + 50).map((id) =>
        env.DB.prepare(
          `INSERT INTO upload (id, user_id, item_id, version, envelope_json,
             key, reserved_bytes, created_at, finalized_at, bytes)
           VALUES (?, ?, ?, '1.0.0', '{}', ?, ?, ?, NULL, NULL)`,
        ).bind(
          id,
          AUTHOR,
          ITEM_ID,
          pendingKey(id),
          MAX_ARCHIVE_BYTES,
          createdAt,
        ),
      ),
    );
  }
  return ids.map((id) => pendingKey(id));
}

async function rowExists(id: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT id FROM upload WHERE id = ?")
    .bind(id)
    .first<{ id: string }>();
  return row !== null;
}
