import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { favoriteCount } from "../src/db/favorites";
import { thumbnailKey } from "../src/storage/keys";
import { BASE, sessionHeaders, USER_ID } from "./helpers";
import {
  downloads,
  fixturePackageKey,
  ITEM_ID,
  indexIds,
  seedPublished,
  statusOf,
  versionsOf,
} from "./seed";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";
const FOREIGN_OWNER = "user-somebody-else";

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
