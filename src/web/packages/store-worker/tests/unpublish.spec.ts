import { env, SELF } from "cloudflare:test";
import { collectionManifest } from "@yunari/theme-package";
import { beforeAll, describe, expect, it } from "vitest";
import { favoriteCount } from "../src/db/favorites";
import { thumbnailKey } from "../src/storage/keys";
import { BASE, sessionHeaders, USER_ID } from "./helpers";
import {
  downloads,
  fixturePackageKey,
  ITEM_ID,
  indexIds,
  putPackage,
  seedPublished,
  statusOf,
  versionsOf,
} from "./seed";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";
const FOREIGN_OWNER = "user-somebody-else";
const COLLECTION_ID = "22222222-2222-4222-8222-222222222222";
const MEMBER_ID = "33333333-3333-4333-8333-333333333333";
const INSTANT = "2026-10-01T00:00:00.000Z";

/**
 * An unpublished collection at one version, whose stored package is a real
 * collection manifest naming `MEMBER_ID`, plus the member in the state a spec
 * chooses.
 */
async function seedCollectionRepublish(
  memberStatus: "published" | "unpublished",
): Promise<void> {
  for (const id of [COLLECTION_ID, MEMBER_ID]) {
    await env.DB.prepare("DELETE FROM item_version WHERE item_id = ?")
      .bind(id)
      .run();
    await env.DB.prepare("DELETE FROM item WHERE id = ?").bind(id).run();
  }

  const insertItem = async (
    id: string,
    kind: string,
    status: string,
  ): Promise<void> => {
    await env.DB.prepare(
      `INSERT INTO item (id, kind, author_user_id, name, status, status_reason,
         created_at, updated_at, published_at, unpublished_at, removed_at,
         downloads, remix_of_id)
       VALUES (?, ?, ?, 'Seeded', ?, NULL, ?, ?, NULL, NULL, NULL, 0, NULL)`,
    )
      .bind(id, kind, USER_ID, status, INSTANT, INSTANT)
      .run();
  };

  await insertItem(MEMBER_ID, "dashboard-theme", memberStatus);
  await insertItem(COLLECTION_ID, "collection", "unpublished");

  const bytes = collectionManifest({
    name: "Ops Pack",
    description: "",
    includes: [{ id: MEMBER_ID, optional: false }],
  });
  await env.DB.prepare(
    `INSERT INTO item_version (item_id, version, envelope_json, facets_json,
       package_key, thumbnail_key, bytes, sha256, created_at)
     VALUES (?, '1.0.0', '{}', '{}', ?, ?, ?, ?, ?)`,
  )
    .bind(
      COLLECTION_ID,
      fixturePackageKey(COLLECTION_ID, "1.0.0"),
      thumbnailKey(COLLECTION_ID),
      bytes.byteLength,
      "0".repeat(64),
      INSTANT,
    )
    .run();
  await putPackage(fixturePackageKey(COLLECTION_ID, "1.0.0"), bytes);
}

describe("unpublish and republish", () => {
  beforeAll(async () => {
    // Better Auth owns `user`; only `/migrate` creates it.
    const migrated = await SELF.fetch(`${BASE}/migrate`, {
      method: "POST",
      headers: { "x-migrate-token": "test-migrate" },
    });
    expect(migrated.status).toBe(200);
  });

  it("hides every read, keeps the record, and restores the listing on republish", async () => {
    const headers = await sessionHeaders();
    await seedPublished({
      owner: USER_ID,
      versions: ["1.0.0", "1.0.1"],
      downloads: 4,
      favorites: 2,
    });

    const unpublished = await unpublish(headers, ITEM_ID);
    expect(unpublished.status).toBe(200);
    expect(await unpublished.json()).toEqual({
      ok: true,
      status: "unpublished",
    });
    expect(await statusOf(env.DB, ITEM_ID)).toBe("unpublished");
    expect(await indexIds()).not.toContain(ITEM_ID);
    for (const path of ["item.json", "thumbnail.png", "1.0.0.zip", "1.0.1.zip"])
      expect(
        (await SELF.fetch(`${BASE}/catalogue/${ITEM_ID}/${path}`)).status,
      ).toBe(404);

    // Nothing else changed: counters, favourites, versions and objects stay.
    // The refused download above must not have counted either — a withdrawal
    // stops new installs, it does not rewrite the history it already has.
    expect(await downloads(env.DB, ITEM_ID)).toBe(4);
    expect(await favoriteCount(env.DB, ITEM_ID)).toBe(2);
    expect(await versionsOf(env.DB, ITEM_ID)).toEqual(["1.0.0", "1.0.1"]);
    for (const version of ["1.0.0", "1.0.1"])
      expect(
        await env.BUCKET.get(fixturePackageKey(ITEM_ID, version)),
      ).not.toBeNull();
    expect(await env.BUCKET.get(thumbnailKey(ITEM_ID))).not.toBeNull();

    const republished = await publish(headers, ITEM_ID);
    expect(republished.status).toBe(200);
    expect(await republished.json()).toEqual({ ok: true, status: "published" });
    expect(await statusOf(env.DB, ITEM_ID)).toBe("published");
    expect(await indexIds()).toContain(ITEM_ID);
    expect(await downloads(env.DB, ITEM_ID)).toBe(4);
    expect(await versionsOf(env.DB, ITEM_ID)).toEqual(["1.0.0", "1.0.1"]);
  });

  it("refuses to republish a collection whose stored include is unpublished", async () => {
    const headers = await sessionHeaders();
    await seedCollectionRepublish("unpublished");

    const refused = await publish(headers, COLLECTION_ID);
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain(MEMBER_ID);
    expect(await statusOf(env.DB, COLLECTION_ID)).toBe("unpublished");

    // The same listing publishes once its member does.
    await env.DB.prepare("UPDATE item SET status = 'published' WHERE id = ?")
      .bind(MEMBER_ID)
      .run();
    const republished = await publish(headers, COLLECTION_ID);
    expect(republished.status).toBe(200);
    expect(await statusOf(env.DB, COLLECTION_ID)).toBe("published");
  });

  it("404s a foreign or missing id and 401s without a session", async () => {
    const headers = await sessionHeaders();
    await seedPublished({ owner: FOREIGN_OWNER, status: "published" });

    for (const action of ["unpublish", "publish"] as const) {
      expect((await transition(headers, action, ITEM_ID)).status).toBe(404);
      expect((await transition(headers, action, MISSING_ID)).status).toBe(404);
      expect((await transition({}, action, ITEM_ID)).status).toBe(401);
    }
    expect(await statusOf(env.DB, ITEM_ID)).toBe("published");
  });

  it("409s an unpublish with no published row, naming the status", async () => {
    const headers = await sessionHeaders();

    for (const status of [
      "draft",
      "pending",
      "unpublished",
      "removed",
    ] as const) {
      await seedPublished({ owner: USER_ID, status });
      const response = await unpublish(headers, ITEM_ID);
      expect(response.status).toBe(409);
      expect(await response.text()).toContain(`is ${status};`);
      expect(await statusOf(env.DB, ITEM_ID)).toBe(status);
    }
  });

  it("403s a removed item's republish with the owner's reason", async () => {
    const headers = await sessionHeaders();
    await seedPublished({ owner: USER_ID, status: "removed" });
    await env.DB.prepare("UPDATE item SET status_reason = ? WHERE id = ?")
      .bind("Broken preview", ITEM_ID)
      .run();

    const refused = await publish(headers, ITEM_ID);
    expect(refused.status).toBe(403);
    expect(await refused.text()).toBe("Broken preview");

    // A takedown with no stored sentence still says the owner removed it.
    await env.DB.prepare("UPDATE item SET status_reason = NULL WHERE id = ?")
      .bind(ITEM_ID)
      .run();
    const bare = await publish(headers, ITEM_ID);
    expect(bare.status).toBe(403);
    expect(await bare.text()).toContain("removed");
    expect(await statusOf(env.DB, ITEM_ID)).toBe("removed");
  });

  it("409s a publish from any state but unpublished", async () => {
    const headers = await sessionHeaders();

    for (const status of [
      "draft",
      "pending",
      "published",
      "rejected",
    ] as const) {
      await seedPublished({ owner: USER_ID, status });
      const response = await publish(headers, ITEM_ID);
      expect(response.status).toBe(409);
      expect(await response.text()).toContain(`is ${status};`);
      expect(await statusOf(env.DB, ITEM_ID)).toBe(status);
    }
  });
});

function unpublish(
  headers: Record<string, string>,
  itemId: string,
): Promise<Response> {
  return transition(headers, "unpublish", itemId);
}

function publish(
  headers: Record<string, string>,
  itemId: string,
): Promise<Response> {
  return transition(headers, "publish", itemId);
}

function transition(
  headers: Record<string, string>,
  action: "unpublish" | "publish",
  itemId: string,
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/me/items/${itemId}/${action}`, {
    method: "POST",
    headers,
  });
}
