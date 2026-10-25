import { env } from "cloudflare:test";
import { MAX_ARCHIVE_BYTES } from "@yunari/theme-package";
import { describe, expect, it } from "vitest";
import {
  authorQuotaExceeded,
  pendingBytes,
  UPLOAD_RESERVATION_TTL_MS,
} from "../src/db/quota";

/** `MAX_AUTHOR_BYTES` in quota.ts: the account-wide ceiling under test. */
const GIB = 1024 * 1024 * 1024;
const STORED_AT = "2026-10-01T00:00:00.000Z";

/** One item with one finalized version, so the join in the quota has bytes. */
async function seedStoredVersion(
  userId: string,
  itemId: string,
  bytes: number,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO item (id, kind, author_user_id, name, status, created_at,
       updated_at, downloads)
     VALUES (?, 'dashboard-theme', ?, 'Quota item', 'draft', ?, ?, 0)`,
  )
    .bind(itemId, userId, STORED_AT, STORED_AT)
    .run();
  await env.DB.prepare(
    `INSERT INTO item_version (item_id, version, envelope_json, facets_json,
       package_key, thumbnail_key, bytes, sha256, created_at)
     VALUES (?, '1.0.0', '{}', '{}', 'packages/k.zip', 'thumbnails/k.png', ?,
       'sha', ?)`,
  )
    .bind(itemId, bytes, STORED_AT)
    .run();
}

interface Reservation {
  readonly id: string;
  readonly userId: string;
  readonly itemId?: string;
  readonly reservedBytes: number;
  readonly createdAt?: string;
  readonly finalizedAt?: string | null;
  readonly bytes?: number | null;
}

async function reserve(options: Reservation): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO upload (id, user_id, item_id, version, envelope_json, key,
       reserved_bytes, created_at, finalized_at, bytes)
     VALUES (?, ?, ?, '1.0.0', '{}', 'packages/k.zip', ?, ?, ?, ?)`,
  )
    .bind(
      options.id,
      options.userId,
      options.itemId ?? "quota-upload-item",
      options.reservedBytes,
      options.createdAt ?? new Date().toISOString(),
      options.finalizedAt ?? null,
      options.bytes ?? null,
    )
    .run();
}

describe("author quota", () => {
  it("counts every unexpired reservation, not just one", async () => {
    const userId = "user-quota-two-pending";
    // Two reservations plus the request's own cap are the whole remaining
    // budget: one pending row fits exactly, a second does not.
    await seedStoredVersion(
      userId,
      "quota-item-two-pending",
      GIB - 2 * MAX_ARCHIVE_BYTES,
    );
    await reserve({
      id: "quota-upload-pending-a",
      userId,
      reservedBytes: MAX_ARCHIVE_BYTES,
    });
    await reserve({
      id: "quota-upload-pending-b",
      userId,
      reservedBytes: MAX_ARCHIVE_BYTES,
    });

    expect(
      await authorQuotaExceeded(env.DB, userId, MAX_ARCHIVE_BYTES, false),
    ).toBe("bytes");

    await env.DB.prepare("DELETE FROM upload WHERE id = ?")
      .bind("quota-upload-pending-b")
      .run();
    expect(
      await authorQuotaExceeded(env.DB, userId, MAX_ARCHIVE_BYTES, false),
    ).toBeUndefined();
  });

  it("counts a finalized upload only through its item version", async () => {
    const userId = "user-quota-finalized";
    const itemId = "quota-item-finalized";
    const stored = GIB - 10;
    await seedStoredVersion(userId, itemId, stored);
    await reserve({
      id: "quota-upload-finalized",
      userId,
      itemId,
      reservedBytes: MAX_ARCHIVE_BYTES,
      finalizedAt: STORED_AT,
      bytes: stored,
    });

    // Only the item_version row counts: ten bytes remain, nothing is pending.
    expect(await authorQuotaExceeded(env.DB, userId, 0, false)).toBeUndefined();
    expect(await pendingBytes(env.DB, userId, new Date())).toBe(0);
    // The join's bytes are what the check sees, so twenty more is over.
    expect(await authorQuotaExceeded(env.DB, userId, 20, false)).toBe("bytes");
  });

  it("ignores a reservation older than the TTL", async () => {
    const userId = "user-quota-stale";
    await seedStoredVersion(userId, "quota-item-stale", GIB - 10);
    await reserve({
      id: "quota-upload-stale",
      userId,
      reservedBytes: MAX_ARCHIVE_BYTES,
      createdAt: new Date(
        Date.now() - UPLOAD_RESERVATION_TTL_MS - 60_000,
      ).toISOString(),
    });

    expect(await authorQuotaExceeded(env.DB, userId, 0, false)).toBeUndefined();
    expect(await pendingBytes(env.DB, userId, new Date())).toBe(0);
  });

  it("never counts another user's reservation", async () => {
    const ownerId = "user-quota-owner";
    const otherId = "user-quota-other";
    await seedStoredVersion(ownerId, "quota-item-owner", GIB - 10);
    await reserve({
      id: "quota-upload-other",
      userId: otherId,
      reservedBytes: MAX_ARCHIVE_BYTES,
    });

    expect(
      await authorQuotaExceeded(env.DB, ownerId, 0, false),
    ).toBeUndefined();
    expect(await pendingBytes(env.DB, ownerId, new Date())).toBe(0);
    // The row exists; it is simply not the owner's.
    expect(await pendingBytes(env.DB, otherId, new Date())).toBe(
      MAX_ARCHIVE_BYTES,
    );
  });

  it("expires a reservation exactly at the TTL boundary", async () => {
    const userId = "user-quota-boundary";
    await seedStoredVersion(userId, "quota-item-boundary", GIB - 10);
    const now = new Date("2030-01-01T00:00:00.000Z");
    const expiredAt = new Date(
      now.getTime() - UPLOAD_RESERVATION_TTL_MS,
    ).toISOString();
    const liveAt = new Date(
      now.getTime() - UPLOAD_RESERVATION_TTL_MS + 1,
    ).toISOString();

    // Exactly one hour old is the cutoff itself, and the query is `>`.
    await reserve({
      id: "quota-upload-boundary-expired",
      userId,
      reservedBytes: MAX_ARCHIVE_BYTES,
      createdAt: expiredAt,
    });
    expect(
      await authorQuotaExceeded(env.DB, userId, 0, false, now),
    ).toBeUndefined();
    expect(await pendingBytes(env.DB, userId, now)).toBe(0);

    // One millisecond younger still counts.
    await reserve({
      id: "quota-upload-boundary-live",
      userId,
      reservedBytes: MAX_ARCHIVE_BYTES,
      createdAt: liveAt,
    });
    expect(await authorQuotaExceeded(env.DB, userId, 0, false, now)).toBe(
      "bytes",
    );
    expect(await pendingBytes(env.DB, userId, now)).toBe(MAX_ARCHIVE_BYTES);
  });

  it("refuses a finalized upload with no byte count", async () => {
    await expect(
      reserve({
        id: "quota-upload-finalized-no-bytes",
        userId: "user-quota-no-bytes",
        reservedBytes: MAX_ARCHIVE_BYTES,
        finalizedAt: STORED_AT,
        bytes: null,
      }),
    ).rejects.toThrow(/CHECK constraint failed/);
  });

  it("refuses non-finite or negative extra bytes", async () => {
    for (const extraBytes of [Number.NaN, Infinity, -Infinity, -1]) {
      await expect(
        authorQuotaExceeded(env.DB, "user-quota-invalid", extraBytes, false),
      ).rejects.toBeInstanceOf(RangeError);
    }
  });
});
