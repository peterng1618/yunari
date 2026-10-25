import { env, SELF } from "cloudflare:test";
import { MAX_ARCHIVE_BYTES } from "@yunari/theme-package";
import { beforeAll, describe, expect, it } from "vitest";
import { UPLOAD_RESERVATION_TTL_MS } from "../src/db/quota";
import type { Env } from "../src/env";
import { MAX_JSON_BODY } from "../src/routes/body";
import { handleMe, pumpInto } from "../src/routes/me";
import { pendingKey } from "../src/storage/keys";
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

const FOREIGN_ID = "00000000-0000-4000-8000-000000000000";
const NEW_ID = "9f1c2a3b-4d5e-4f60-8a71-2b3c4d5e6f70";
const GIB = 1024 * 1024 * 1024;
const OTHER_USER_ID = "user-other";

interface UploadRow {
  readonly id: string;
  readonly user_id: string;
  readonly item_id: string;
  readonly version: string;
  readonly key: string;
  readonly reserved_bytes: number;
  readonly finalized_at: string | null;
}

async function uploadRow(id: string): Promise<UploadRow | null> {
  return await env.DB.prepare("SELECT * FROM upload WHERE id = ?")
    .bind(id)
    .first<UploadRow>();
}

/** One reservation minted by a version request, and its route. */
async function reserved(
  headers: Record<string, string>,
): Promise<{ readonly id: string; readonly url: string }> {
  // A first submission of the item, so the ladder's version is `1.0.0` whatever
  // the earlier cases in this file stored. Earlier reservations are cleared:
  // each is a 95 MiB cap against a 1 GiB author budget.
  await env.DB.prepare("DELETE FROM upload WHERE user_id = ?")
    .bind(USER_ID)
    .run();
  await seedItem(ITEM_ID, USER_ID);
  const response = await createVersion(headers, ITEM_ID);
  expect(response.status, await response.clone().text()).toBe(200);
  const { uploadUrl } = (await response.json()) as { uploadUrl: string };
  const url = new URL(uploadUrl);
  return { id: url.pathname.slice("/api/me/uploads/".length), url: uploadUrl };
}

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

  it("reserves the upload derived from the session and the computed version", async () => {
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

    // The URL is this Worker's own route, not an R2 address: the bytes go
    // through the Worker so their size can be bounded before they land.
    const upload = new URL(body.uploadUrl);
    expect(upload.origin).toBe(BASE);
    const uploadId = upload.pathname.slice("/api/me/uploads/".length);
    expect(upload.pathname).toBe(`/api/me/uploads/${uploadId}`);
    expect(uploadId.length).toBeGreaterThan(0);

    // The reservation exists before the response, with the cap it stands for:
    // the next request's quota check must see these bytes already spoken for.
    const row = await uploadRow(uploadId);
    expect(row).toMatchObject({
      user_id: USER_ID,
      item_id: ITEM_ID,
      version: "1.0.0",
      key: pendingKey(uploadId),
      reserved_bytes: MAX_ARCHIVE_BYTES,
      finalized_at: null,
    });

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
    await seedItem(FOREIGN_ID, OTHER_USER_ID);
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

  it("gates the item ceiling at the draft insert", async () => {
    const headers = await sessionHeaders();
    const ID_A = "9f1c2a3b-4d5e-4f60-8a71-2b3c4d5e6f81";
    const ID_B = "9f1c2a3b-4d5e-4f60-8a71-2b3c4d5e6f82";

    await env.DB.prepare("DELETE FROM upload WHERE user_id = ?")
      .bind(USER_ID)
      .run();
    await env.DB.prepare("DELETE FROM presign_event WHERE user_id = ?")
      .bind(USER_ID)
      .run();
    // 19 items: both requests pass the reservation's item arm, because neither
    // new draft row exists yet, so only the draft insert can refuse the 20th.
    await seedItems({ userId: USER_ID, count: 19 });

    // Both started before either answers, and dispatched to the route directly:
    // the test pool's `SELF.fetch` serialises requests, which would prove only
    // the sequence.
    const version = (id: string) => {
      const path = `${BASE}/api/me/items/${id}/versions`;
      return handleMe(
        new Request(path, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ envelope: candidate(id), name: "Mine" }),
        }),
        env,
        new URL(path),
      );
    };
    const [a, b] = await Promise.all([version(ID_A), version(ID_B)]);

    expect([a?.status, b?.status].sort()).toEqual([200, 429]);
    const items = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM item WHERE author_user_id = ?",
    )
      .bind(USER_ID)
      .first<{ n: number }>();
    expect(items?.n).toBe(20);
    const reservations = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM upload WHERE user_id = ?",
    )
      .bind(USER_ID)
      .first<{ n: number }>();
    expect(reservations?.n).toBe(1);
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

  it("bounds a new item's name in UTF-8 bytes", async () => {
    const headers = await sessionHeaders();
    // The case creates an item, so the author's earlier rows and hourly budget
    // must not stand in the way of the version ladder.
    await seedItems({ userId: USER_ID, count: 0 });
    await env.DB.prepare("DELETE FROM presign_event WHERE user_id = ?")
      .bind(USER_ID)
      .run();
    await env.DB.prepare("DELETE FROM upload WHERE user_id = ?")
      .bind(USER_ID)
      .run();

    const long = await createVersion(headers, NEW_ID, {
      name: "a".repeat(201),
    });
    expect(long.status).toBe(400);
    expect(await long.text()).toBe("An item name may be at most 200 bytes.");

    // 67 three-byte characters: 201 UTF-8 bytes but only 67 UTF-16 units, so a
    // `.length` check would let it through.
    expect(
      (await createVersion(headers, NEW_ID, { name: "あ".repeat(67) })).status,
    ).toBe(400);

    const accepted = await createVersion(headers, NEW_ID, {
      name: "a".repeat(200),
    });
    expect(accepted.status).toBe(200);
    const stored = await env.DB.prepare("SELECT name FROM item WHERE id = ?")
      .bind(NEW_ID)
      .first<{ name: string }>();
    expect(stored).toEqual({ name: "a".repeat(200) });
  });

  it("accepts a version body of exactly the cap and refuses one byte more", async () => {
    const headers = await sessionHeaders();
    await seedItems({ userId: USER_ID, count: 0 });
    await env.DB.prepare("DELETE FROM presign_event WHERE user_id = ?")
      .bind(USER_ID)
      .run();
    await env.DB.prepare("DELETE FROM upload WHERE user_id = ?")
      .bind(USER_ID)
      .run();

    // Trailing JSON whitespace pads the envelope to the byte the cap allows.
    const json = JSON.stringify({ envelope: candidate(NEW_ID), name: "Mine" });
    const exact = json + " ".repeat(MAX_JSON_BODY - json.length);
    expect(exact.length).toBe(MAX_JSON_BODY);
    const accepted = await SELF.fetch(
      `${BASE}/api/me/items/${NEW_ID}/versions`,
      {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: exact,
      },
    );
    expect(accepted.status, await accepted.clone().text()).toBe(200);

    const over = await SELF.fetch(`${BASE}/api/me/items/${NEW_ID}/versions`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: `${exact} `,
    });
    expect(over.status).toBe(413);
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

  it("stores an authenticated upload under its pending key", async () => {
    const headers = await sessionHeaders();
    const { id, url } = await reserved(headers);
    const bytes = new TextEncoder().encode("the uploaded package");

    const response = await SELF.fetch(url, {
      method: "PUT",
      headers: { ...headers, "content-length": String(bytes.byteLength) },
      body: bytes,
    });
    expect(response.status).toBe(201);

    const head = await env.BUCKET.head(pendingKey(id));
    expect(head?.size).toBe(bytes.byteLength);
    expect(await (await env.BUCKET.get(pendingKey(id)))?.text()).toBe(
      "the uploaded package",
    );
  });

  it("refuses an upload with no content-length", async () => {
    const headers = await sessionHeaders();
    const { url } = await reserved(headers);

    const response = await SELF.fetch(url, { method: "PUT", headers });
    expect(response.status).toBe(411);

    // Only decimal digits are a length: `Number` would read exponents, hex,
    // an empty string and a signed form as a number. (Surrounding whitespace
    // never reaches the route: the transport trims header values.)
    const { url: strictUrl } = await reserved(headers);
    for (const value of ["1e3", "0x10", "", "+1", "1.0"]) {
      const request = {
        method: "PUT",
        url: strictUrl,
        headers: new Headers({ ...headers, "content-length": value }),
        body: null,
      } as unknown as Request;
      const strict = await handleMe(request, env, new URL(strictUrl));
      expect(strict?.status, `content-length "${value}"`).toBe(411);
    }
  });

  it("refuses an over-cap upload before consuming its body", async () => {
    const headers = await sessionHeaders();
    const { id, url } = await reserved(headers);

    // A hand-built request whose `body` is a getter: the route's only use of the
    // request before the refusal is its headers, and workerd's `Request` would
    // buffer a stream at construction, so this is the one shape that can show
    // the body was never reached.
    let touched = false;
    const request = {
      method: "PUT",
      url,
      headers: new Headers({
        ...headers,
        "content-length": String(MAX_ARCHIVE_BYTES + 1),
      }),
      get body() {
        touched = true;
        return new ReadableStream<Uint8Array>();
      },
    } as unknown as Request;
    const response = await handleMe(request, env, new URL(url));

    expect(response?.status).toBe(413);
    expect(touched).toBe(false);
    expect(await env.BUCKET.head(pendingKey(id))).toBeNull();
  });

  it("stops a body that outruns its declared length at the cap", async () => {
    const headers = await sessionHeaders();
    const { id, url } = await reserved(headers);

    // An understated header with a larger stream: the route must stop reading
    // once the cap is passed rather than store the bytes and delete them after.
    const MIB = 1024 * 1024;
    const SENT = 120;
    let produced = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (produced >= SENT * MIB) {
          controller.close();
          return;
        }
        produced += MIB;
        controller.enqueue(new Uint8Array(MIB));
      },
    });
    const request = {
      method: "PUT",
      url,
      headers: new Headers({ ...headers, "content-length": "1" }),
      body,
    } as unknown as Request;
    const response = await handleMe(request, env, new URL(url));

    expect(response?.status).toBeGreaterThanOrEqual(400);
    expect(response?.status).toBeLessThan(500);
    expect(await env.BUCKET.head(pendingKey(id))).toBeNull();
    // The pump stops within one chunk of the declared length (1 byte), so a
    // transformer that ran to the 95 MiB cap before stopping cannot pass here.
    expect(produced).toBeLessThanOrEqual(1 + MIB);

    // The runtime logs two `uncaught exception ... client disconnected` lines
    // for this case: the sink is torn down under `BUCKET.put` when the body
    // overruns. They are workerd's teardown of that stream, not an unhandled
    // rejection from this route, and they are accepted — do not assert on
    // stderr.
  });

  it("answers 500, not 400, when the store itself fails", async () => {
    const headers = await sessionHeaders();
    const { url } = await reserved(headers);
    const bytes = new TextEncoder().encode("the uploaded package");

    // R2 faults after reading a well-formed body: the body was not at fault, so
    // the refusal is the Worker's and not the client's.
    const faulty = {
      ...env,
      BUCKET: {
        put: async (
          _key: string,
          value: ReadableStream<Uint8Array>,
        ): Promise<never> => {
          await new Response(value).arrayBuffer();
          throw new Error("R2 fault");
        },
      },
    } as unknown as Env;

    const response = await handleMe(
      new Request(url, {
        method: "PUT",
        headers: { ...headers, "content-length": String(bytes.byteLength) },
        body: new Uint8Array(bytes),
      }),
      faulty,
      new URL(url),
    );
    expect(response?.status).toBe(500);
    expect(await response?.text()).toBe("The upload could not be stored.");
  });

  it("releases the reservation when a step after it throws", async () => {
    const headers = await sessionHeaders();
    const ID = "9f1c2a3b-4d5e-4f60-8a71-2b3c4d5e6f83";
    await env.DB.prepare("DELETE FROM upload WHERE user_id = ?")
      .bind(USER_ID)
      .run();
    await env.DB.prepare("DELETE FROM presign_event WHERE user_id = ?")
      .bind(USER_ID)
      .run();
    // A new item is required, so the ceiling must not refuse it first.
    await env.DB.prepare(
      "DELETE FROM item_version WHERE item_id IN (SELECT id FROM item WHERE author_user_id = ?)",
    )
      .bind(USER_ID)
      .run();
    await env.DB.prepare("DELETE FROM item WHERE author_user_id = ?")
      .bind(USER_ID)
      .run();

    // A second in-flight reservation for the same author: the compensation must
    // delete only the failed request's row, not every row this user owns.
    const KEPT_ID = "kept-reservation";
    await env.DB.prepare(
      `INSERT INTO upload (id, user_id, item_id, version, envelope_json, key,
         reserved_bytes, created_at, finalized_at, bytes)
       VALUES (?, ?, ?, '1.0.0', '{}', ?, ?, ?, NULL, NULL)`,
    )
      .bind(
        KEPT_ID,
        USER_ID,
        ITEM_ID,
        pendingKey(KEPT_ID),
        MAX_ARCHIVE_BYTES,
        new Date().toISOString(),
      )
      .run();

    // The real binding everywhere except the presign write, whose `run` throws:
    // that is a step after the reservation, so the route must compensate.
    const realPrepare = env.DB.prepare.bind(env.DB);
    const broken = {
      ...env,
      DB: new Proxy(env.DB, {
        get(target, property) {
          if (property === "prepare") {
            return (sql: string) =>
              sql.includes("INSERT INTO presign_event")
                ? {
                    bind: () => ({
                      run: async () => {
                        throw new Error("presign write failed");
                      },
                    }),
                  }
                : realPrepare(sql);
          }
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    } as unknown as Env;

    const path = `${BASE}/api/me/items/${ID}/versions`;
    await expect(
      handleMe(
        new Request(path, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ envelope: candidate(ID), name: "Mine" }),
        }),
        broken,
        new URL(path),
      ),
    ).rejects.toThrow("presign write failed");

    // Exactly the seeded row survives, with its key: a user-scoped delete would
    // have taken it too, which is what the counter alone could not tell.
    const rows = await env.DB.prepare(
      "SELECT id, item_id, key FROM upload WHERE user_id = ? ORDER BY id",
    )
      .bind(USER_ID)
      .all<{ id: string; item_id: string; key: string }>();
    expect(rows.results).toEqual([
      { id: KEPT_ID, item_id: ITEM_ID, key: pendingKey(KEPT_ID) },
    ]);
    const failed = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM upload WHERE item_id = ?",
    )
      .bind(ID)
      .first<{ n: number }>();
    expect(failed?.n).toBe(0);
  });

  it("refuses a second PUT of the same unfinalised upload URL", async () => {
    const headers = await sessionHeaders();
    const { id, url } = await reserved(headers);
    const bytes = new TextEncoder().encode("the only write");

    const first = await SELF.fetch(url, {
      method: "PUT",
      headers: { ...headers, "content-length": String(bytes.byteLength) },
      body: bytes,
    });
    expect(first.status).toBe(201);

    const replay = await SELF.fetch(url, {
      method: "PUT",
      headers: { ...headers, "content-length": String(bytes.byteLength) },
      body: bytes,
    });
    expect(replay.status).toBe(409);
    // The URL has already been written once; the object is the first write's.
    expect((await env.BUCKET.head(pendingKey(id)))?.size).toBe(
      bytes.byteLength,
    );
  });

  it("refuses a concurrent second writer of one upload URL", async () => {
    const headers = await sessionHeaders();
    const { id, url } = await reserved(headers);
    const bytes = new TextEncoder().encode("the race winner");

    // Called on the route directly, both started before either answers: the
    // test pool's `SELF.fetch` serialises requests, which would hide the race
    // behind a head check that always sees the first write.
    const put = () =>
      handleMe(
        new Request(url, {
          method: "PUT",
          headers: { ...headers, "content-length": String(bytes.byteLength) },
          body: new Uint8Array(bytes),
        }),
        env,
        new URL(url),
      );
    const [first, second] = await Promise.all([put(), put()]);

    // The write itself is exclusive: both requests pass any pre-check, so only
    // the conditional put can decide, and exactly one of them wins.
    expect([first?.status, second?.status].sort()).toEqual([201, 409]);
    expect((await env.BUCKET.head(pendingKey(id)))?.size).toBe(
      bytes.byteLength,
    );
  });

  it("answers 405 for any method other than PUT on an upload route", async () => {
    const response = await SELF.fetch(`${BASE}/api/me/uploads/anything`, {
      method: "GET",
    });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("PUT");
  });

  it("refuses an upload with no session and another account's upload", async () => {
    const headers = await sessionHeaders();
    const { url } = await reserved(headers);

    expect(
      (
        await SELF.fetch(url, {
          method: "PUT",
          headers: { "content-length": "1" },
          body: new Uint8Array([1]),
        })
      ).status,
    ).toBe(401);

    const foreignId = "foreign-upload";
    await env.DB.prepare(
      `INSERT INTO upload (id, user_id, item_id, version, envelope_json, key,
         reserved_bytes, created_at, finalized_at, bytes)
       VALUES (?, ?, ?, '1.0.0', '{}', ?, ?, ?, NULL, NULL)`,
    )
      .bind(
        foreignId,
        OTHER_USER_ID,
        ITEM_ID,
        pendingKey(foreignId),
        MAX_ARCHIVE_BYTES,
        new Date().toISOString(),
      )
      .run();
    expect(
      (
        await SELF.fetch(`${BASE}/api/me/uploads/${foreignId}`, {
          method: "PUT",
          headers: { ...headers, "content-length": "1" },
          body: new Uint8Array([1]),
        })
      ).status,
    ).toBe(404);
  });

  it("refuses a second upload of a finalised reservation", async () => {
    const headers = await sessionHeaders();
    const finalizedId = "finalized-upload";
    await env.DB.prepare(
      `INSERT INTO upload (id, user_id, item_id, version, envelope_json, key,
         reserved_bytes, created_at, finalized_at, bytes)
       VALUES (?, ?, ?, '1.0.0', '{}', ?, ?, ?, ?, 3)`,
    )
      .bind(
        finalizedId,
        USER_ID,
        ITEM_ID,
        pendingKey(finalizedId),
        MAX_ARCHIVE_BYTES,
        new Date().toISOString(),
        new Date().toISOString(),
      )
      .run();

    const response = await SELF.fetch(`${BASE}/api/me/uploads/${finalizedId}`, {
      method: "PUT",
      headers: { ...headers, "content-length": "3" },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(response.status).toBe(409);
  });

  it("answers a finalized reservation aged past the hour as already finalized", async () => {
    const headers = await sessionHeaders();
    const finalizedId = "finalized-expired-upload";
    const old = new Date(
      Date.now() - UPLOAD_RESERVATION_TTL_MS - 60_000,
    ).toISOString();
    await env.DB.prepare(
      `INSERT INTO upload (id, user_id, item_id, version, envelope_json, key,
         reserved_bytes, created_at, finalized_at, bytes)
       VALUES (?, ?, ?, '1.0.0', '{}', ?, ?, ?, ?, 3)`,
    )
      .bind(
        finalizedId,
        USER_ID,
        ITEM_ID,
        pendingKey(finalizedId),
        MAX_ARCHIVE_BYTES,
        old,
        old,
      )
      .run();

    // The finalized branch is checked first: a retried PUT belongs there even
    // when the row is old enough for cleanup to be deleting its object.
    const response = await SELF.fetch(`${BASE}/api/me/uploads/${finalizedId}`, {
      method: "PUT",
      headers: { ...headers, "content-length": "3" },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(response.status).toBe(409);
    expect(await response.text()).toBe("This upload is already finalized.");
    expect(await env.BUCKET.head(pendingKey(finalizedId))).toBeNull();
  });

  it("refuses a PUT to an expired reservation and still writes a fresh one", async () => {
    const headers = await sessionHeaders();
    const { id, url } = await reserved(headers);
    // One hour old: finalize refuses it and cleanup will delete its object.
    await env.DB.prepare("UPDATE upload SET created_at = ? WHERE id = ?")
      .bind(new Date(Date.now() - UPLOAD_RESERVATION_TTL_MS).toISOString(), id)
      .run();

    const bytes = new TextEncoder().encode("too late");
    const expired = await SELF.fetch(url, {
      method: "PUT",
      headers: { ...headers, "content-length": String(bytes.byteLength) },
      body: bytes,
    });
    expect(expired.status).toBe(409);
    expect(await expired.text()).toBe(
      "This upload expired; request a new version.",
    );
    expect(await env.BUCKET.head(pendingKey(id))).toBeNull();

    const fresh = await reserved(headers);
    const stored = await SELF.fetch(fresh.url, {
      method: "PUT",
      headers: { ...headers, "content-length": String(bytes.byteLength) },
      body: bytes,
    });
    expect(stored.status).toBe(201);
  });

  it("sees the first reservation in the next request's quota check", async () => {
    const headers = await sessionHeaders();
    // One reservation fits the remaining budget exactly; a second breaks it.
    // Sequential by construction: it proves the row is visible after the first
    // request answered, not that two in-flight requests cannot both pass.
    await env.DB.prepare("DELETE FROM upload WHERE user_id = ?")
      .bind(USER_ID)
      .run();
    await env.DB.prepare(
      "DELETE FROM item_version WHERE item_id IN (SELECT id FROM item WHERE author_user_id = ?)",
    )
      .bind(USER_ID)
      .run();
    await env.DB.prepare("DELETE FROM item WHERE author_user_id = ?")
      .bind(USER_ID)
      .run();
    await env.DB.prepare(
      `INSERT INTO item (id, kind, author_user_id, name, status, created_at,
         updated_at, downloads)
       VALUES (?, 'dashboard-theme', ?, 'Burst', 'draft', ?, ?, 0)`,
    )
      .bind(
        ITEM_ID,
        USER_ID,
        "2026-10-01T00:00:00.000Z",
        "2026-10-01T00:00:00.000Z",
      )
      .run();
    await env.DB.prepare(
      `INSERT INTO item_version (item_id, version, envelope_json, facets_json,
         package_key, thumbnail_key, bytes, sha256, created_at)
       VALUES (?, '1.0.0', ?, '{}', 'packages/k.zip', 'thumbnails/k.png', ?,
         'sha', '2026-10-01T00:00:00.000Z')`,
    )
      .bind(
        ITEM_ID,
        JSON.stringify(candidate(ITEM_ID)),
        GIB - MAX_ARCHIVE_BYTES,
      )
      .run();

    const bumped = { envelope: candidate(ITEM_ID, "1.0.1") };
    const first = await createVersion(headers, ITEM_ID, bumped);
    expect(first.status, await first.clone().text()).toBe(200);
    const second = await createVersion(headers, ITEM_ID, bumped);
    expect(second.status).toBe(429);
  });

  it("gives a parallel first submission's budget to exactly one request", async () => {
    const headers = await sessionHeaders();
    const STORED_ID = "20000000-0000-4000-8000-000000000001";
    const ID_A = "9f1c2a3b-4d5e-4f60-8a71-2b3c4d5e6f71";
    const ID_B = "9f1c2a3b-4d5e-4f60-8a71-2b3c4d5e6f72";

    await env.DB.prepare("DELETE FROM upload WHERE user_id = ?")
      .bind(USER_ID)
      .run();
    await env.DB.prepare(
      "DELETE FROM item_version WHERE item_id IN (SELECT id FROM item WHERE author_user_id = ?)",
    )
      .bind(USER_ID)
      .run();
    await env.DB.prepare("DELETE FROM item WHERE author_user_id = ?")
      .bind(USER_ID)
      .run();
    // One stored version leaves room for exactly one reservation; both requests
    // race that single room, and nothing between the checks may let both in.
    await env.DB.prepare(
      `INSERT INTO item (id, kind, author_user_id, name, status, created_at,
         updated_at, downloads)
       VALUES (?, 'dashboard-theme', ?, 'Stored', 'draft', ?, ?, 0)`,
    )
      .bind(
        STORED_ID,
        USER_ID,
        "2026-10-01T00:00:00.000Z",
        "2026-10-01T00:00:00.000Z",
      )
      .run();
    await env.DB.prepare(
      `INSERT INTO item_version (item_id, version, envelope_json, facets_json,
         package_key, thumbnail_key, bytes, sha256, created_at)
       VALUES (?, '1.0.0', '{}', '{}', 'packages/k.zip', 'thumbnails/k.png', ?,
         'sha', '2026-10-01T00:00:00.000Z')`,
    )
      .bind(STORED_ID, GIB - MAX_ARCHIVE_BYTES)
      .run();

    // Two different new items, both started before either can answer, and
    // dispatched to the route directly: the test pool's `SELF.fetch` serialises
    // requests, which would prove only the sequence.
    const version = (id: string) => {
      const path = `${BASE}/api/me/items/${id}/versions`;
      return handleMe(
        new Request(path, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ envelope: candidate(id), name: "Mine" }),
        }),
        env,
        new URL(path),
      );
    };
    const [a, b] = await Promise.all([version(ID_A), version(ID_B)]);

    expect([a?.status, b?.status].sort()).toEqual([200, 429]);
    const reservations = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM upload WHERE user_id = ?",
    )
      .bind(USER_ID)
      .first<{ n: number }>();
    expect(reservations?.n).toBe(1);
  });
});

describe("pumpInto", () => {
  const CHUNK = new TextEncoder().encode("abc");

  function sink(failWrite: boolean): {
    readonly writable: WritableStream<ArrayBuffer | ArrayBufferView>;
  } {
    return {
      writable: new WritableStream<ArrayBuffer | ArrayBufferView>({
        write() {
          if (failWrite) throw new Error("store fault");
        },
      }),
    };
  }

  function body(...chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
  }

  it("calls a sink failure within the length the store's", async () => {
    const atFault = await pumpInto(body(CHUNK), sink(true), CHUNK.byteLength);
    expect(atFault).toBe(false);
  });

  it("calls a body that overruns its length the body's", async () => {
    const atFault = await pumpInto(
      body(CHUNK, CHUNK),
      sink(false),
      CHUNK.byteLength,
    );
    expect(atFault).toBe(true);
  });

  it("calls a body that ends short the body's", async () => {
    const atFault = await pumpInto(
      body(CHUNK),
      sink(false),
      CHUNK.byteLength + 1,
    );
    expect(atFault).toBe(true);
  });
});
