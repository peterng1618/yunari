import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  BASE,
  candidate,
  createVersion,
  sessionHeaders,
  USER_ID,
} from "./helpers";
import {
  ITEM_ID,
  seedItem,
  seedItems,
  seedPresigns,
  seedPublished,
} from "./seed";

/** `R2_BUCKET_NAME` in vitest.config.ts's bindings. */
const BUCKET = "yunari-store-packages";
const FOREIGN_ID = "00000000-0000-4000-8000-000000000000";
const NEW_ID = "9f1c2a3b-4d5e-4f60-8a71-2b3c4d5e6f70";

describe("version requests", () => {
  beforeAll(async () => {
    // Better Auth owns `user` and `session`; the catalogue migration does not
    // create them, and every request here carries a session.
    const migrated = await SELF.fetch(`${BASE}/migrate`, {
      method: "POST",
      headers: { "x-migrate-token": "test-migrate" },
    });
    expect(migrated.status).toBe(200);
  });

  it("signs only the key derived from the session and the computed version", async () => {
    const headers = await sessionHeaders();
    const response = await createVersion(headers, ITEM_ID);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      version: string;
      status: string;
      uploadUrl: string;
    };
    expect(body.version).toBe("1.0.0");
    // No `author_profile` row yet, so the finalize these presigns is pending.
    expect(body.status).toBe("pending");

    const upload = new URL(body.uploadUrl);
    expect(upload.pathname).toBe(`/${BUCKET}/packages/${ITEM_ID}/1.0.0.zip`);
    expect(upload.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(upload.searchParams.get("X-Amz-Signature")).not.toBeNull();

    // Finalize (Task 2.3) reads this row instead of re-validating the upload.
    const event = await env.DB.prepare(
      `SELECT item_id, version, envelope_json FROM presign_event
       WHERE user_id = ? AND item_id = ? ORDER BY id DESC LIMIT 1`,
    )
      .bind(USER_ID, ITEM_ID)
      .first<{ item_id: string; version: string; envelope_json: string }>();
    expect(event?.item_id).toBe(ITEM_ID);
    expect(event?.version).toBe("1.0.0");
    expect(JSON.parse(event?.envelope_json ?? "null")).toMatchObject(
      candidate(ITEM_ID),
    );

    // Another account's item answers exactly as a missing one.
    await seedItem(FOREIGN_ID, "user-other");
    expect((await createVersion(headers, FOREIGN_ID)).status).toBe(404);

    // The response names the state finalize will apply: a verified author's
    // submission publishes, an unverified one queues.
    await env.DB.prepare(
      "INSERT INTO author_profile (user_id, verified) VALUES (?, 1)",
    )
      .bind(USER_ID)
      .run();
    const verified = await createVersion(headers, ITEM_ID);
    expect(verified.status).toBe(200);
    expect((await verified.json()) as { status: string }).toMatchObject({
      status: "published",
    });
  });

  it("refuses the 21st item and the 61st presign in an hour", async () => {
    const headers = await sessionHeaders();
    await seedItems({ userId: USER_ID, count: 20 });
    expect((await createVersion(headers, NEW_ID)).status).toBe(429);

    // The 20 items exist, so this request creates no item and only the
    // trailing-hour presign count can refuse it.
    await seedPresigns({ userId: USER_ID, count: 60, withinHour: true });
    expect((await createVersion(headers, ITEM_ID)).status).toBe(429);
  });

  it("refuses a removed item with its reason", async () => {
    const headers = await sessionHeaders();
    await seedItem(ITEM_ID, USER_ID, {
      status: "removed",
      statusReason: "Owner took it down.",
    });
    const response = await createVersion(headers, ITEM_ID);
    expect(response.status).toBe(409);
    expect(await response.text()).toBe("Owner took it down.");
  });

  it("queues a verified author's resubmission of a rejected item", async () => {
    const headers = await sessionHeaders();
    await seedItem(ITEM_ID, USER_ID, {
      status: "rejected",
      statusReason: "Not yet.",
    });
    await env.DB.prepare(
      `INSERT INTO author_profile (user_id, verified) VALUES (?, 1)
       ON CONFLICT(user_id) DO UPDATE SET verified = 1`,
    )
      .bind(USER_ID)
      .run();
    // The pool keeps D1 rows between tests in a file, and the quota test
    // fills the trailing hour; this request is about the status, not the cap.
    await env.DB.prepare("DELETE FROM presign_event WHERE user_id = ?")
      .bind(USER_ID)
      .run();

    const response = await createVersion(headers, ITEM_ID);
    expect(response.status).toBe(200);
    // The status machine's `rejected -> pending` row outranks the verified
    // author's general publish rule: the owner re-approves it.
    expect((await response.json()) as { status: string }).toMatchObject({
      status: "pending",
    });
  });

  it("refuses an envelope whose id is not the path's and writes nothing", async () => {
    const headers = await sessionHeaders();
    const response = await SELF.fetch(
      `${BASE}/api/me/items/${NEW_ID}/versions`,
      {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ envelope: candidate(ITEM_ID), name: "Mine" }),
      },
    );
    expect(response.status).toBe(400);
    const message = await response.text();
    expect(message).toContain(NEW_ID);
    expect(message).toContain(ITEM_ID);

    // A refused request signs nothing and leaves no pending-upload record.
    const events = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM presign_event WHERE item_id = ?",
    )
      .bind(NEW_ID)
      .first<{ n: number }>();
    expect(events).toEqual({ n: 0 });
    const items = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM item WHERE id = ?",
    )
      .bind(NEW_ID)
      .first<{ n: number }>();
    expect(items).toEqual({ n: 0 });
  });

  it("answers the author's baseline in any state and hides a foreign one", async () => {
    const headers = await sessionHeaders();
    await seedPublished({ owner: USER_ID, status: "unpublished" });
    const own = await SELF.fetch(`${BASE}/api/me/items/${ITEM_ID}/baseline`, {
      headers,
    });
    expect(own.status).toBe(200);
    expect(await own.json()).toEqual({
      version: "1.0.0",
      createdAt: "2026-10-01T00:00:00.000Z",
      envelope: { schemaVersion: "2.0.0", metadata: {} },
      status: "unpublished",
    });

    await seedPublished({ owner: "user-other" });
    expect(
      (
        await SELF.fetch(`${BASE}/api/me/items/${ITEM_ID}/baseline`, {
          headers,
        })
      ).status,
    ).toBe(404);
  });

  it("migrates a legacy stored envelope before planning the next version", async () => {
    const headers = await sessionHeaders();
    await seedPublished({ owner: USER_ID });
    // The shape a version row written before the semver switch carries.
    await env.DB.prepare(
      "UPDATE item_version SET envelope_json = ? WHERE item_id = ?",
    )
      .bind(
        JSON.stringify({
          ...candidate(ITEM_ID),
          schemaVersion: 2,
          metadata: { themeLanguage: "en" },
        }),
        ITEM_ID,
      )
      .run();

    // The baseline an author reads is the migrated document, not the integer.
    const baseline = await SELF.fetch(
      `${BASE}/api/me/items/${ITEM_ID}/baseline`,
      { headers },
    );
    expect(baseline.status).toBe(200);
    expect(
      ((await baseline.json()) as { envelope: { schemaVersion: string } })
        .envelope.schemaVersion,
    ).toBe("2.0.0");

    // Renaming the theme is a patch. A raw integer `2` against `"2.0.0"` would
    // read as a schema change and publish a false major.
    const response = await createVersion(headers, ITEM_ID, {
      envelope: {
        ...candidate(ITEM_ID, "1.0.1"),
        metadata: { themeLanguage: "en", version: "1.0.1", name: "Renamed" },
      },
    });
    expect(response.status).toBe(200);
    expect((await response.json()) as { version: string }).toMatchObject({
      version: "1.0.1",
    });
  });
});
