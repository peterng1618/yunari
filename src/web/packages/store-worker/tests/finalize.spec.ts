import { env, SELF } from "cloudflare:test";
import { type FabricThemeEnvelope, facetRecordOf } from "@yunari/renderer-core";
import { MAX_ARCHIVE_BYTES } from "@yunari/theme-package";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { finalizeStoredVersion } from "../src/db/finalize";
import { markFinalized } from "../src/db/items";
import { UPLOAD_RESERVATION_TTL_MS } from "../src/db/quota";
import {
  differentBytes,
  MAX_FINALIZE_BODY,
  MAX_THUMBNAIL_BASE64,
  takenDown,
} from "../src/routes/me";
import { pendingKey, thumbnailKey } from "../src/storage/keys";
import { inspectObject } from "../src/storage/objects";
import {
  BASE,
  candidate,
  createVersion,
  sessionHeaders,
  USER_ID,
} from "./helpers";
import {
  ITEM_ID,
  indexIds,
  PACKAGE_BYTES,
  putPackage,
  seedItem,
  statusOf,
  versionsOf,
} from "./seed";

const FOREIGN_ID = "00000000-0000-4000-8000-000000000000";
const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
/** Two distinct valid PNGs, so a repeat finalize can prove it wrote neither. */
const FIRST_PNG = pngWith(0x01);
const SECOND_PNG = pngWith(0x02);
const THUMBNAIL_PNG = base64Of(FIRST_PNG);
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const UPLOAD_PREFIX = "/api/me/uploads/";

describe("finalize", () => {
  beforeAll(async () => {
    // Better Auth owns `user` and `session`; only `/migrate` creates them.
    const migrated = await SELF.fetch(`${BASE}/migrate`, {
      method: "POST",
      headers: { "x-migrate-token": "test-migrate" },
    });
    expect(migrated.status).toBe(200);
  });

  it("queues an unverified author's upload and 404s a missing object", async () => {
    const headers = await sessionHeaders();
    await reset();
    const { version, uploadId, key } = await reserve(headers);
    await putPackage(key, PACKAGE_BYTES);

    const response = await finalize(headers, version);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      status: "pending",
      version,
    });
    expect(await statusOf(env.DB, ITEM_ID)).toBe("pending");
    expect(await indexIds()).not.toContain(ITEM_ID);

    const row = await env.DB.prepare(
      "SELECT * FROM item_version WHERE item_id = ? AND version = ?",
    )
      .bind(ITEM_ID, version)
      .first<{
        envelope_json: string;
        facets_json: string;
        package_key: string;
        thumbnail_key: string;
        bytes: number;
        sha256: string;
      }>();
    expect(row?.package_key).toBe(key);
    expect(row?.thumbnail_key).toBe(thumbnailKey(ITEM_ID));
    expect(row?.bytes).toBe(PACKAGE_BYTES.byteLength);
    expect(row?.sha256).toBe(await sha256Hex(PACKAGE_BYTES));
    expect(row?.facets_json).toBe(
      JSON.stringify(
        facetRecordOf(candidate(ITEM_ID) as unknown as FabricThemeEnvelope),
      ),
    );
    const presign = await env.DB.prepare(
      `SELECT envelope_json FROM presign_event
       WHERE user_id = ? AND item_id = ? AND version = ?
       ORDER BY id DESC LIMIT 1`,
    )
      .bind(USER_ID, ITEM_ID, version)
      .first<{ envelope_json: string }>();
    expect(row?.envelope_json).toBe(presign?.envelope_json);

    const thumbnail = await env.BUCKET.get(thumbnailKey(ITEM_ID));
    expect(thumbnail?.httpMetadata?.contentType).toBe("image/png");

    // The reservation is released with the bytes actually stored, and the
    // object stays where the upload put it.
    const upload = await uploadRow(uploadId);
    expect(upload?.key).toBe(key);
    expect(upload?.finalized_at).not.toBeNull();
    expect(upload?.bytes).toBe(PACKAGE_BYTES.byteLength);
    // The release records the version's own size, read from the row that names
    // the key, never a figure supplied by the request.
    expect(upload?.bytes).toBe(row?.bytes);
    expect(await env.BUCKET.head(key)).not.toBeNull();

    // The version row now exists, but a missing object is still a 404.
    await env.BUCKET.delete(key);
    expect((await finalize(headers, version)).status).toBe(404);
  });

  it("404s a version whose package was never written and keeps the reservation", async () => {
    const headers = await sessionHeaders();
    await reset();
    const { version, uploadId } = await reserve(headers);

    expect((await finalize(headers, version)).status).toBe(404);

    const upload = await uploadRow(uploadId);
    expect(upload?.finalized_at).toBeNull();
    expect(upload?.bytes).toBeNull();
    expect(await versionsOf(env.DB, ITEM_ID)).toEqual([]);
  });

  it("picks the reservation whose object exists, not the newest row", async () => {
    const headers = await sessionHeaders();
    await reset();
    const older = await reserve(headers);
    const newer = await reserve(headers);
    expect(newer.version).toBe(older.version);
    await putPackage(older.key, PACKAGE_BYTES);

    const response = await finalize(headers, older.version);
    expect(response.status).toBe(200);
    expect(await storedPackageKey(older.version)).toBe(older.key);
    expect((await uploadRow(older.uploadId))?.finalized_at).not.toBeNull();
    expect((await uploadRow(newer.uploadId))?.finalized_at).toBeNull();
  });

  it("releases only the row the stored version names", async () => {
    const headers = await sessionHeaders();
    await reset();
    const older = await reserve(headers);
    const newer = await reserve(headers);
    await putPackage(older.key, PACKAGE_BYTES);
    await putPackage(newer.key, PACKAGE_BYTES);

    expect((await finalize(headers, older.version)).status).toBe(200);

    const stored = await storedPackageKey(older.version);
    const storedIsOlder = stored === older.key;
    const released = await uploadRow(
      storedIsOlder ? older.uploadId : newer.uploadId,
    );
    const untouched = await uploadRow(
      storedIsOlder ? newer.uploadId : older.uploadId,
    );
    expect(storedIsOlder || stored === newer.key).toBe(true);
    expect(released?.finalized_at).not.toBeNull();
    expect(released?.bytes).toBe(PACKAGE_BYTES.byteLength);
    expect(untouched?.finalized_at).toBeNull();
    expect(untouched?.bytes).toBeNull();
  });

  it("releases the stored row after a lost insert race, not the picked one", async () => {
    const headers = await sessionHeaders();
    await reset();
    await verifyAuthor(1);
    const older = await reserve(headers);
    const newer = await reserve(headers);
    await putPackage(older.key, PACKAGE_BYTES);
    await putPackage(newer.key, PACKAGE_BYTES);

    // The shape a lost `OR IGNORE` race leaves: a parallel finalize landed the
    // version row naming the older reservation, and this request would pick the
    // newer one. The release has to follow the stored key, not the pick.
    await insertLandedVersion(
      older.version,
      oneSecondAfter(await itemUpdatedAt()),
      older.key,
    );

    expect((await finalize(headers, older.version)).status).toBe(200);
    expect(await storedPackageKey(older.version)).toBe(older.key);
    expect((await uploadRow(older.uploadId))?.finalized_at).not.toBeNull();
    expect((await uploadRow(newer.uploadId))?.finalized_at).toBeNull();
  });

  it("releases with the stored version's size in the batch itself", async () => {
    await reset();
    const version = "1.0.0";
    const olderKey = pendingKey("batch-older");
    const newerKey = pendingKey("batch-newer");
    await seedUpload("batch-older", olderKey, version);
    await seedUpload("batch-newer", newerKey, version);
    await putPackage(olderKey, PACKAGE_BYTES);

    // A version row a parallel finalize already landed, naming the older key.
    const storedBytes = PACKAGE_BYTES.byteLength;
    await insertLandedVersion(version, "2026-10-01T00:00:00.000Z", olderKey);

    // The candidate names the same key with a different size: a release that
    // took the caller's figure would write this one onto the stored row.
    const wrote = await finalizeStoredVersion(
      env.DB,
      {
        item_id: ITEM_ID,
        version,
        envelope_json: "{}",
        facets_json: "{}",
        package_key: olderKey,
        thumbnail_key: thumbnailKey(ITEM_ID),
        bytes: storedBytes + 7,
        sha256: "0".repeat(64),
        created_at: "2026-10-01T00:00:01.000Z",
      },
      "2026-10-01T00:00:02.000Z",
    );
    expect(wrote).toBe(false);

    const older = await uploadRow("batch-older");
    expect(older?.finalized_at).not.toBeNull();
    expect(older?.bytes).toBe(storedBytes);
    const newer = await uploadRow("batch-newer");
    expect(newer?.finalized_at).toBeNull();
    expect(newer?.bytes).toBeNull();
  });

  it("hashes a package by streaming it, never buffering it", async () => {
    const bytes = new TextEncoder().encode("streamed package");
    const bucket = {
      get: async () => ({
        size: bytes.byteLength,
        body: new Response(bytes).body,
        arrayBuffer: () => {
          throw new Error("arrayBuffer must not be called");
        },
      }),
    } as unknown as R2Bucket;

    expect(await inspectObject(bucket, "pending/streamed.zip")).toEqual({
      bytes: bytes.byteLength,
      sha256: await sha256Hex(bytes),
    });
  });

  it("refuses an object past MAX_ARCHIVE_BYTES without storing a version", async () => {
    const headers = await sessionHeaders();
    await reset();
    const { version, key } = await reserve(headers);
    await putPackage(key, new Uint8Array(MAX_ARCHIVE_BYTES + 1));

    const response = await finalize(headers, version);
    expect(response.status).toBe(422);
    expect(await versionsOf(env.DB, ITEM_ID)).toEqual([]);
    expect(await env.BUCKET.get(thumbnailKey(ITEM_ID))).toBeNull();
  });

  it("returns a rejected item to the queue on a new version, verified or not", async () => {
    const headers = await sessionHeaders();
    await reset();
    await seedItem(ITEM_ID, USER_ID, {
      status: "rejected",
      statusReason: "Not yet.",
    });
    await verifyAuthor(1);
    const { version, key } = await reserve(headers);
    await putPackage(key, PACKAGE_BYTES);

    const response = await finalize(headers, version);
    expect(response.status).toBe(200);
    // `rejected -> pending` outranks the verified author's publish rule.
    expect(await response.json()).toEqual({
      ok: true,
      status: "pending",
      version,
    });
    expect(await statusOf(env.DB, ITEM_ID)).toBe("pending");
    // The rejection sentence must not survive the transition.
    const reason = await env.DB.prepare(
      "SELECT status_reason FROM item WHERE id = ?",
    )
      .bind(ITEM_ID)
      .first<{ status_reason: string | null }>();
    expect(reason?.status_reason).toBeNull();
  });

  it("publishes a verified author's upload and is idempotent per version", async () => {
    const headers = await sessionHeaders();
    await reset();
    await verifyAuthor(1);
    const { version, uploadId, key } = await reserve(headers);
    await putPackage(key, PACKAGE_BYTES);

    const first = await finalize(headers, version, base64Of(FIRST_PNG));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      ok: true,
      status: "published",
      version,
    });
    expect(await indexIds()).toContain(ITEM_ID);
    const publishedBefore = await publishedAtOf();
    expect(publishedBefore).not.toBeNull();

    // Same version, different valid thumbnail: a no-op, nothing is rewritten.
    const again = await finalize(headers, version, base64Of(SECOND_PNG));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({
      ok: true,
      status: "published",
      version,
    });
    expect(await versionsOf(env.DB, ITEM_ID)).toEqual([version]);
    expect(await publishedAtOf()).toBe(publishedBefore);
    expect(await thumbnailBytes()).toEqual(Array.from(FIRST_PNG));
    // Per-row, not a count: deleting the release leaves both fields null.
    const upload = await uploadRow(uploadId);
    expect(upload?.finalized_at).not.toBeNull();
    expect(upload?.bytes).toBe(PACKAGE_BYTES.byteLength);

    await putPackage(key, new TextEncoder().encode("different bytes"));
    expect((await finalize(headers, version)).status).toBe(409);
  });

  it("finishes a finalize interrupted between its version row and its status", async () => {
    const headers = await sessionHeaders();
    await reset();
    await verifyAuthor(1);
    const { version, uploadId, key } = await reserve(headers);
    await putPackage(key, PACKAGE_BYTES);

    // The crash the retry has to survive: the version row landed, and the item
    // is still the draft the version request created. A real finalize's instant
    // is later than the item's last move, which is what the retry compares.
    expect(await statusOf(env.DB, ITEM_ID)).toBe("draft");
    await insertLandedVersion(
      version,
      oneSecondAfter(await itemUpdatedAt()),
      key,
    );

    const response = await finalize(headers, version);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      status: "published",
      version,
    });
    expect(await statusOf(env.DB, ITEM_ID)).toBe("published");
    // The retry heals the release the interrupted attempt never wrote.
    const upload = await uploadRow(uploadId);
    expect(upload?.finalized_at).not.toBeNull();
    expect(upload?.bytes).toBe(PACKAGE_BYTES.byteLength);
  });

  it("replays an unpublished item's version without republishing it", async () => {
    const headers = await sessionHeaders();
    await reset();
    await verifyAuthor(1);
    const { version, key } = await reserve(headers);
    await putPackage(key, PACKAGE_BYTES);
    expect((await finalize(headers, version)).status).toBe(200);

    const later = oneSecondAfter(await itemUpdatedAt());
    await env.DB.prepare(
      `UPDATE item SET status = 'unpublished', unpublished_at = ?,
         updated_at = ? WHERE id = ?`,
    )
      .bind(later, later, ITEM_ID)
      .run();

    // The presigned address outlives the request that minted it, so a replay
    // must not reverse the author's withdrawal.
    const replay = await finalize(headers, version);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({
      ok: true,
      status: "unpublished",
      version,
    });
    expect(await statusOf(env.DB, ITEM_ID)).toBe("unpublished");
  });

  it("replays a rejected item's version without undoing the rejection", async () => {
    const headers = await sessionHeaders();
    await reset();
    const { version, key } = await reserve(headers);
    await putPackage(key, PACKAGE_BYTES);
    expect((await finalize(headers, version)).status).toBe(200);

    const later = oneSecondAfter(await itemUpdatedAt());
    await env.DB.prepare(
      `UPDATE item SET status = 'rejected', status_reason = 'Not yet.',
         updated_at = ? WHERE id = ?`,
    )
      .bind(later, ITEM_ID)
      .run();

    const replay = await finalize(headers, version);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({
      ok: true,
      status: "rejected",
      version,
    });
    expect(await statusOf(env.DB, ITEM_ID)).toBe("rejected");
    const reason = await env.DB.prepare(
      "SELECT status_reason FROM item WHERE id = ?",
    )
      .bind(ITEM_ID)
      .first<{ status_reason: string | null }>();
    expect(reason?.status_reason).toBe("Not yet.");
  });

  it("replays a published item's version without demoting an unverified author", async () => {
    const headers = await sessionHeaders();
    await reset();
    await verifyAuthor(1);
    const { version, key } = await reserve(headers);
    await putPackage(key, PACKAGE_BYTES);
    expect((await finalize(headers, version)).status).toBe(200);

    // The status write and the version row share one instant, so this replay is
    // the equal-instant case: it must read as already settled.
    await verifyAuthor(0);
    const replay = await finalize(headers, version);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({
      ok: true,
      status: "published",
      version,
    });
    expect(await statusOf(env.DB, ITEM_ID)).toBe("published");
  });

  it("refuses a status write for an item the owner removed meanwhile", async () => {
    await reset();
    await seedItem(ITEM_ID, USER_ID, {
      status: "removed",
      statusReason: "Owner took it down.",
    });

    // The state the route's own read never sees: the takedown lands between the
    // read and the write. The guarded UPDATE is the whole defence.
    expect(
      await markFinalized(
        env.DB,
        ITEM_ID,
        "published",
        new Date().toISOString(),
      ),
    ).toBe(false);
    expect(await statusOf(env.DB, ITEM_ID)).toBe("removed");
  });

  it("answers a takedown that raced the read with 409 and its reason", async () => {
    await reset();
    await seedItem(ITEM_ID, USER_ID, {
      status: "removed",
      statusReason: "Owner took it down.",
    });

    const response = await takenDown(env, ITEM_ID);
    expect(response.status).toBe(409);
    expect(await response.text()).toBe("Owner took it down.");
  });

  it("answers a differing-bytes loser with 409 and its sentence", async () => {
    const response = differentBytes("2.0.0");
    expect(response.status).toBe(409);
    expect(await response.text()).toBe(
      'Version "2.0.0" already exists with different bytes.',
    );
  });

  it("lets a second version insert converge instead of failing on the key", async () => {
    await reset();
    const row = {
      item_id: ITEM_ID,
      version: "1.0.0",
      envelope_json: "{}",
      facets_json: "{}",
      package_key: pendingKey("insert-fixture"),
      thumbnail_key: thumbnailKey(ITEM_ID),
      bytes: PACKAGE_BYTES.byteLength,
      sha256: await sha256Hex(PACKAGE_BYTES),
      created_at: "2026-10-01T00:00:00.000Z",
    };

    expect(
      await finalizeStoredVersion(env.DB, row, "2026-10-01T00:00:01.000Z"),
    ).toBe(true);
    expect(
      await finalizeStoredVersion(env.DB, row, "2026-10-01T00:00:01.000Z"),
    ).toBe(false);
    expect(await versionsOf(env.DB, ITEM_ID)).toEqual(["1.0.0"]);
  });

  it("advances published_at when a new version returns an unpublished item", async () => {
    const headers = await sessionHeaders();
    await reset();
    await verifyAuthor(1);
    const first = await reserve(headers);
    await putPackage(first.key, PACKAGE_BYTES);
    expect((await finalize(headers, first.version)).status).toBe(200);
    expect(await statusOf(env.DB, ITEM_ID)).toBe("published");

    const old = "2020-01-01T00:00:00.000Z";
    await env.DB.prepare(
      `UPDATE item SET status = 'unpublished', unpublished_at = ?,
         published_at = ? WHERE id = ?`,
    )
      .bind(old, old, ITEM_ID)
      .run();

    const next = await reserve(headers, nextCandidate("1.1.0"));
    expect(next.version).toBe("1.1.0");
    await putPackage(next.key, PACKAGE_BYTES);
    const response = await finalize(headers, next.version);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      status: "published",
      version: next.version,
    });
    expect(await publishedAtOf()).not.toBe(old);
    expect(await indexIds()).toContain(ITEM_ID);

    // A new version on a still-published item is not a transition into
    // `published`, so the instant recorded by the re-entry stays put.
    const pinned = "2021-01-01T00:00:00.000Z";
    await env.DB.prepare("UPDATE item SET published_at = ? WHERE id = ?")
      .bind(pinned, ITEM_ID)
      .run();
    const third = await reserve(
      headers,
      nextCandidate("1.2.0", ["minimal", "retro"]),
    );
    expect(third.version).toBe("1.2.0");
    await putPackage(third.key, PACKAGE_BYTES);
    expect((await finalize(headers, third.version)).status).toBe(200);
    expect(await publishedAtOf()).toBe(pinned);
  });

  it("queues a new version when the author is no longer verified", async () => {
    const headers = await sessionHeaders();
    await reset();
    await verifyAuthor(1);
    const first = await reserve(headers);
    await putPackage(first.key, PACKAGE_BYTES);
    expect((await finalize(headers, first.version)).status).toBe(200);
    expect(await indexIds()).toContain(ITEM_ID);

    await verifyAuthor(0);
    const next = await reserve(headers, nextCandidate("1.1.0"));
    expect(next.version).toBe("1.1.0");
    await putPackage(next.key, PACKAGE_BYTES);
    const response = await finalize(headers, next.version);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      status: "pending",
      version: next.version,
    });
    expect(await statusOf(env.DB, ITEM_ID)).toBe("pending");
    expect(await indexIds()).not.toContain(ITEM_ID);
  });

  it("refuses a foreign or removed item and a version nobody requested", async () => {
    const headers = await sessionHeaders();
    await reset();

    await seedItem(FOREIGN_ID, "somebody-else");
    expect(
      (await finalize(headers, "1.0.0", THUMBNAIL_PNG, FOREIGN_ID)).status,
    ).toBe(404);

    await seedItem(ITEM_ID, USER_ID, {
      status: "removed",
      statusReason: "Owner took it down.",
    });
    const removed = await finalize(headers, "1.0.0");
    expect(removed.status).toBe(409);
    expect(await removed.text()).toBe("Owner took it down.");

    await seedItem(ITEM_ID, USER_ID, { status: "draft" });
    expect((await finalize(headers, "1.0.0")).status).toBe(409);
  });

  it("refuses a reservation older than the hour without writing a version", async () => {
    const headers = await sessionHeaders();
    await reset();
    const { version, uploadId, key } = await reserve(headers);
    await putPackage(key, PACKAGE_BYTES);
    await ageReservation(uploadId);

    const response = await finalize(headers, version);
    expect(response.status).toBe(409);
    expect(await response.text()).toBe(
      "This upload expired; request a new version.",
    );
    expect(await versionsOf(env.DB, ITEM_ID)).toEqual([]);
    expect(await env.BUCKET.get(thumbnailKey(ITEM_ID))).toBeNull();
    expect((await uploadRow(uploadId))?.finalized_at).toBeNull();
  });

  it("replays an existing version on an expired reservation", async () => {
    const headers = await sessionHeaders();
    await reset();
    await verifyAuthor(1);
    const { version, uploadId, key } = await reserve(headers);
    await putPackage(key, PACKAGE_BYTES);
    expect((await finalize(headers, version)).status).toBe(200);

    // The replay must answer what it always did: only the insert path expires.
    await ageReservation(uploadId);
    const replay = await finalize(headers, version);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({
      ok: true,
      status: "published",
      version,
    });
  });

  it("refuses a thumbnail that is not a PNG or is over 2 MiB", async () => {
    const headers = await sessionHeaders();
    await reset();
    const { version, key } = await reserve(headers);
    await putPackage(key, PACKAGE_BYTES);

    const notPng = await finalize(headers, version, base64Of(utf8("GIF89a")));
    expect(notPng.status).toBe(422);

    expect((await finalize(headers, version, "not base64!")).status).toBe(422);

    const big = new Uint8Array(MAX_THUMBNAIL_BYTES + 1);
    big.set(PNG_SIGNATURE);
    expect((await finalize(headers, version, base64Of(big))).status).toBe(422);

    expect(await versionsOf(env.DB, ITEM_ID)).toEqual([]);
    expect(await env.BUCKET.get(thumbnailKey(ITEM_ID))).toBeNull();
  });

  it("refuses a base64 thumbnail over the cap before decoding it", async () => {
    const headers = await sessionHeaders();
    await reset();
    const { version, key } = await reserve(headers);
    await putPackage(key, PACKAGE_BYTES);

    const over = "A".repeat(MAX_THUMBNAIL_BASE64 + 1);
    const atobSpy = vi.spyOn(globalThis, "atob");
    try {
      expect((await finalize(headers, version, over)).status).toBe(413);
      expect(atobSpy.mock.calls.some(([value]) => value === over)).toBe(false);
    } finally {
      atobSpy.mockRestore();
    }
    expect(await versionsOf(env.DB, ITEM_ID)).toEqual([]);
    expect(await env.BUCKET.get(thumbnailKey(ITEM_ID))).toBeNull();
  });

  it("refuses an oversized finalize body without parsing it", async () => {
    const headers = await sessionHeaders();
    await reset();
    const { version, key } = await reserve(headers);
    await putPackage(key, PACKAGE_BYTES);

    // The finalize cap carries the base64 thumbnail, so the wrapper alone puts
    // this body one byte past MAX_FINALIZE_BODY.
    const body = JSON.stringify({ thumbnail: "A".repeat(MAX_FINALIZE_BODY) });
    const parseSpy = vi.spyOn(JSON, "parse");
    try {
      const response = await SELF.fetch(
        `${BASE}/api/me/items/${ITEM_ID}/versions/${version}/finalize`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body,
        },
      );
      expect(response.status).toBe(413);
      expect(parseSpy.mock.calls.some(([text]) => text === body)).toBe(false);
    } finally {
      parseSpy.mockRestore();
    }
    expect(await versionsOf(env.DB, ITEM_ID)).toEqual([]);
  });
});

/** A fresh item, presign records and objects for each test in this file. */
async function reset(): Promise<void> {
  await env.DB.prepare("DELETE FROM item_version WHERE item_id = ?")
    .bind(ITEM_ID)
    .run();
  await env.DB.prepare("DELETE FROM item WHERE id = ?").bind(ITEM_ID).run();
  await env.DB.prepare("DELETE FROM favorite WHERE item_id = ?")
    .bind(ITEM_ID)
    .run();
  await env.DB.prepare("DELETE FROM presign_event WHERE user_id = ?")
    .bind(USER_ID)
    .run();
  // Each version request now reserves its archive cap in `upload`; without
  // this the file's own cases exhaust the author's 1 GiB before its last test.
  // The pending objects go with their rows, or the next case sees a stray head.
  const uploads = await env.DB.prepare(
    "SELECT key FROM upload WHERE user_id = ?",
  )
    .bind(USER_ID)
    .all<{ key: string }>();
  const keys = uploads.results.map((row) => row.key);
  if (keys.length > 0) await env.BUCKET.delete(keys);
  await env.DB.prepare("DELETE FROM upload WHERE user_id = ?")
    .bind(USER_ID)
    .run();
  await env.DB.prepare("DELETE FROM author_profile WHERE user_id = ?")
    .bind(USER_ID)
    .run();
  await env.BUCKET.delete(thumbnailKey(ITEM_ID));
}

/** One reservation minted by a version request, and the key its PUT writes. */
async function reserve(
  headers: Record<string, string>,
  envelope?: Record<string, unknown>,
): Promise<{ version: string; uploadId: string; key: string }> {
  const response = await createVersion(
    headers,
    ITEM_ID,
    envelope === undefined ? {} : { envelope },
  );
  expect(response.status, await response.clone().text()).toBe(200);
  const { version, uploadUrl } = (await response.json()) as {
    version: string;
    uploadUrl: string;
  };
  const uploadId = new URL(uploadUrl).pathname.slice(UPLOAD_PREFIX.length);
  return { version, uploadId, key: pendingKey(uploadId) };
}

/** Ages a reservation one second past the TTL cleanup and finalize share. */
async function ageReservation(id: string): Promise<void> {
  await env.DB.prepare("UPDATE upload SET created_at = ? WHERE id = ?")
    .bind(
      new Date(Date.now() - UPLOAD_RESERVATION_TTL_MS - 1000).toISOString(),
      id,
    )
    .run();
}

/** The `upload` row a reservation minted, as finalize's release left it. */
async function uploadRow(id: string): Promise<{
  readonly key: string;
  readonly finalized_at: string | null;
  readonly bytes: number | null;
} | null> {
  return await env.DB.prepare(
    "SELECT key, finalized_at, bytes FROM upload WHERE id = ?",
  )
    .bind(id)
    .first();
}

/** The key the stored version names; the release must follow it. */
async function storedPackageKey(version: string): Promise<string | undefined> {
  const row = await env.DB.prepare(
    "SELECT package_key FROM item_version WHERE item_id = ? AND version = ?",
  )
    .bind(ITEM_ID, version)
    .first<{ package_key: string }>();
  return row?.package_key;
}

/** One reservation row with no version behind it, for the batch's own case. */
async function seedUpload(
  id: string,
  key: string,
  version: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO upload (id, user_id, item_id, version, envelope_json, key,
       reserved_bytes, created_at, finalized_at, bytes)
     VALUES (?, ?, ?, ?, '{}', ?, ?, ?, NULL, NULL)`,
  )
    .bind(
      id,
      USER_ID,
      ITEM_ID,
      version,
      key,
      MAX_ARCHIVE_BYTES,
      new Date().toISOString(),
    )
    .run();
}

/** The same theme with a different tag set, so the ladder mints a minor bump. */
function nextCandidate(
  version: string,
  tags: readonly string[] = ["minimal"],
): Record<string, unknown> {
  const envelope = candidate(ITEM_ID, version);
  const metadata = envelope["metadata"] as Record<string, unknown>;
  metadata["tags"] = tags;
  return envelope;
}

async function verifyAuthor(verified: 0 | 1): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO author_profile (user_id, verified) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET verified = excluded.verified`,
  )
    .bind(USER_ID, verified)
    .run();
}

async function publishedAtOf(): Promise<string | null> {
  const row = await env.DB.prepare("SELECT published_at FROM item WHERE id = ?")
    .bind(ITEM_ID)
    .first<{ published_at: string | null }>();
  return row?.published_at ?? null;
}

async function thumbnailBytes(): Promise<number[] | undefined> {
  const object = await env.BUCKET.get(thumbnailKey(ITEM_ID));
  return object === null
    ? undefined
    : Array.from(new Uint8Array(await object.arrayBuffer()));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as unknown as BufferSource,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** The version row a crash between the two writes leaves: written at `createdAt`,
 *  with the item's own state untouched. */
async function insertLandedVersion(
  version: string,
  createdAt: string,
  key: string,
): Promise<void> {
  const presign = await env.DB.prepare(
    `SELECT envelope_json FROM presign_event
     WHERE user_id = ? AND item_id = ? AND version = ?
     ORDER BY id DESC LIMIT 1`,
  )
    .bind(USER_ID, ITEM_ID, version)
    .first<{ envelope_json: string }>();
  await env.DB.prepare(
    `INSERT INTO item_version (item_id, version, envelope_json, facets_json,
       package_key, thumbnail_key, bytes, sha256, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      ITEM_ID,
      version,
      presign?.envelope_json ?? "{}",
      JSON.stringify(
        facetRecordOf(candidate(ITEM_ID) as unknown as FabricThemeEnvelope),
      ),
      key,
      thumbnailKey(ITEM_ID),
      PACKAGE_BYTES.byteLength,
      await sha256Hex(PACKAGE_BYTES),
      createdAt,
    )
    .run();
}

/** The instant the finalize guard compares against a version row's `created_at`. */
async function itemUpdatedAt(): Promise<string> {
  const row = await env.DB.prepare("SELECT updated_at FROM item WHERE id = ?")
    .bind(ITEM_ID)
    .first<{ updated_at: string }>();
  return row?.updated_at ?? "";
}

/** An instant strictly after `at`, which is what a later transition records. */
function oneSecondAfter(at: string): string {
  return new Date(Date.parse(at) + 1000).toISOString();
}

function pngWith(tail: number): Uint8Array {
  return new Uint8Array([...PNG_SIGNATURE, tail]);
}

async function finalize(
  headers: Record<string, string>,
  version: string,
  thumbnail: string = THUMBNAIL_PNG,
  itemId: string = ITEM_ID,
): Promise<Response> {
  return SELF.fetch(
    `${BASE}/api/me/items/${itemId}/versions/${version}/finalize`,
    {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ thumbnail }),
    },
  );
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function base64Of(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x2000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x2000));
  return btoa(binary);
}
