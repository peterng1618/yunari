import { env, SELF } from "cloudflare:test";
import type { MineEntry } from "@yunari/renderer-core";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handleMe } from "../src/routes/me";
import {
  BASE,
  countingEnv,
  listingStatements,
  sessionHeaders,
  USER_ID,
} from "./helpers";
import { ITEM_ID, seedItem, seedPublished, seedStatus } from "./seed";

const OTHER_ID = "11111111-1111-4111-8111-111111111111";
const THIRD_ID = "22222222-2222-4222-8222-222222222222";
const STRANGER = "user-stranger";
/** The author's own ceiling; a listing past it is refused by the upload route. */
const AUTHOR_ITEM_LIMIT = 20;

describe("GET /api/me/items", () => {
  beforeAll(async () => {
    // Better Auth owns `user`; only `/migrate` creates it.
    const migrated = await SELF.fetch(`${BASE}/migrate`, {
      method: "POST",
      headers: { "x-migrate-token": "test-migrate" },
    });
    expect(migrated.status).toBe(200);
  });

  beforeEach(async () => {
    // The pool keeps D1 rows between a file's tests; every case seeds its own.
    for (const owner of [USER_ID, STRANGER]) {
      await env.DB.prepare(
        "DELETE FROM item_version WHERE item_id IN (SELECT id FROM item WHERE author_user_id = ?)",
      )
        .bind(owner)
        .run();
      await env.DB.prepare("DELETE FROM item WHERE author_user_id = ?")
        .bind(owner)
        .run();
    }
  });

  it("returns the author's unpublished and pending items and nobody else's", async () => {
    const headers = await sessionHeaders();
    await seedPublished({ owner: USER_ID });
    await seedStatus({ id: OTHER_ID, owner: USER_ID, status: "unpublished" });
    await seedStatus({ id: THIRD_ID, owner: STRANGER, status: "published" });

    const body = await mine(headers);

    expect(body.entries.map((entry) => entry.id).sort()).toEqual(
      [ITEM_ID, OTHER_ID].sort(),
    );
    expect(body.entries.find((entry) => entry.id === OTHER_ID)?.status).toBe(
      "unpublished",
    );
    expect(body.entries.some((entry) => entry.id === THIRD_ID)).toBe(false);
  });

  it("draws a row from the latest version, its live favourites and the request origin", async () => {
    const headers = await sessionHeaders();
    await seedPublished({
      owner: USER_ID,
      versions: ["1.0.0", "1.0.1"],
      downloads: 2,
      favorites: 3,
    });

    const [entry, ...rest] = (await mine(headers)).entries;

    expect(rest).toEqual([]);
    expect(entry).toMatchObject({
      id: ITEM_ID,
      version: "1.0.1",
      downloads: 2,
      favorites: 3,
      packageUrl: `${BASE}/catalogue/${ITEM_ID}/1.0.1.zip`,
      thumbnail: `catalogue/${ITEM_ID}/thumbnail.png`,
      status: "published",
    });
    // Absent, not present-and-undefined: `exactOptionalPropertyTypes`.
    expect(entry !== undefined && "statusReason" in entry).toBe(false);
  });

  it("carries the owner's sentence for a rejected item", async () => {
    const headers = await sessionHeaders();
    await seedStatus({
      id: OTHER_ID,
      owner: USER_ID,
      status: "rejected",
      statusReason: "Broken preview",
    });

    const [entry] = (await mine(headers)).entries;

    expect(entry).toMatchObject({
      id: OTHER_ID,
      status: "rejected",
      statusReason: "Broken preview",
    });
  });

  it("keeps a versioned draft and drops the versionless presign leftover", async () => {
    const headers = await sessionHeaders();
    await seedItem(ITEM_ID, USER_ID, { status: "draft" });
    await seedStatus({ id: OTHER_ID, owner: USER_ID, status: "draft" });

    expect((await mine(headers)).entries.map((entry) => entry.id)).toEqual([
      OTHER_ID,
    ]);
  });

  it("orders newest first and breaks a tie by id", async () => {
    const headers = await sessionHeaders();
    await seedStatus({
      id: OTHER_ID,
      owner: USER_ID,
      status: "pending",
      updatedAt: "2026-10-02T00:00:00.000Z",
    });
    await seedStatus({
      id: THIRD_ID,
      owner: USER_ID,
      status: "unpublished",
      updatedAt: "2026-10-03T00:00:00.000Z",
    });

    expect((await mine(headers)).entries.map((entry) => entry.id)).toEqual([
      THIRD_ID,
      OTHER_ID,
    ]);

    await env.DB.prepare("UPDATE item SET updated_at = ? WHERE id IN (?, ?)")
      .bind("2026-10-04T00:00:00.000Z", OTHER_ID, THIRD_ID)
      .run();
    expect((await mine(headers)).entries.map((entry) => entry.id)).toEqual([
      OTHER_ID,
      THIRD_ID,
    ]);
  });

  it("moves a transitioned item to the front because its updated_at advanced", async () => {
    const headers = await sessionHeaders();
    // The older item first in the seed, so the route's write is what moves it.
    await seedStatus({
      id: OTHER_ID,
      owner: USER_ID,
      status: "published",
      updatedAt: "2020-01-01T00:00:00.000Z",
    });
    await seedStatus({
      id: THIRD_ID,
      owner: USER_ID,
      status: "pending",
      updatedAt: "2020-01-02T00:00:00.000Z",
    });

    expect((await mine(headers)).entries.map((entry) => entry.id)).toEqual([
      THIRD_ID,
      OTHER_ID,
    ]);

    const unpublished = await SELF.fetch(
      `${BASE}/api/me/items/${OTHER_ID}/unpublish`,
      { method: "POST", headers },
    );
    expect(unpublished.status).toBe(200);

    // `setStatus` must bump `updated_at`; without it the item keeps its 2020
    // instant and stays behind THIRD_ID.
    expect((await mine(headers)).entries.map((entry) => entry.id)).toEqual([
      OTHER_ID,
      THIRD_ID,
    ]);
  });

  it("reads a full 20-item listing in one statement", async () => {
    const headers = await sessionHeaders();
    const ids = Array.from(
      { length: AUTHOR_ITEM_LIMIT },
      (_, index) =>
        `31000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
    );
    for (const [index, id] of ids.entries()) {
      await seedStatus({
        id,
        owner: USER_ID,
        status: "published",
        updatedAt: new Date(Date.UTC(2026, 9, 1, 0, 0, index)).toISOString(),
      });
      for (let row = 0; row < index % 3; row += 1) {
        await env.DB.prepare(
          "INSERT INTO favorite (user_id, item_id, created_at) VALUES (?, ?, ?)",
        )
          .bind(`fan-${id}-${row}`, id, "2026-10-01T00:00:00.000Z")
          .run();
      }
      // The even items carry a later version, so the answer is not the seed's.
      if (index % 2 === 0) {
        await env.DB.prepare(
          `INSERT INTO item_version (item_id, version, envelope_json,
             facets_json, package_key, thumbnail_key, bytes, sha256, created_at)
           VALUES (?, '2.0.0', '{}', '{}', ?, ?, 1, ?, ?)`,
        )
          .bind(
            id,
            `packages/${id}/2.0.0.zip`,
            `catalogue/${id}/thumbnail.png`,
            "0".repeat(64),
            "2026-10-02T00:00:00.000Z",
          )
          .run();
      }
    }

    const queries: string[] = [];
    const path = `${BASE}/api/me/items`;
    const response = await handleMe(
      new Request(path, { headers }),
      countingEnv(queries),
      new URL(path),
    );
    if (response === undefined)
      throw new Error("The mine route did not answer.");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      readonly entries: readonly MineEntry[];
    };

    // One statement: the item, its latest version and its count all ride it.
    expect(listingStatements(queries)).toHaveLength(1);
    expect(body.entries).toHaveLength(AUTHOR_ITEM_LIMIT);
    for (const [index, id] of ids.entries()) {
      const entry = body.entries.find((candidate) => candidate.id === id);
      expect(entry).toMatchObject({
        version: index % 2 === 0 ? "2.0.0" : "1.0.0",
        favorites: index % 3,
        packageUrl: `${BASE}/catalogue/${id}/${index % 2 === 0 ? "2.0.0" : "1.0.0"}.zip`,
      });
    }
  });

  it("401s without a session", async () => {
    const response = await SELF.fetch(`${BASE}/api/me/items`);
    expect(response.status).toBe(401);
  });
});

async function mine(headers: Record<string, string>): Promise<{
  readonly entries: readonly MineEntry[];
}> {
  const response = await SELF.fetch(`${BASE}/api/me/items`, { headers });
  expect(response.status).toBe(200);
  return (await response.json()) as { readonly entries: readonly MineEntry[] };
}
