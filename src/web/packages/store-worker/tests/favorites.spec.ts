import { env, SELF } from "cloudflare:test";
import type { TestHelpers } from "better-auth/plugins";
import { beforeAll, describe, expect, it } from "vitest";
import { createAuth } from "../src/auth";
import { countsByItem } from "../src/db/favorites";
import { BASE, USER_ID } from "./helpers";
import { clearIndexCache, ITEM_ID, indexIds, seedPublished } from "./seed";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";
const CREATED_AT = "2026-10-01T00:00:00.000Z";

describe("favourites", () => {
  beforeAll(async () => {
    // Better Auth owns `user` and `session`; only `/migrate` creates them.
    const migrated = await SELF.fetch(`${BASE}/migrate`, {
      method: "POST",
      headers: { "x-migrate-token": "test-migrate" },
    });
    expect(migrated.status).toBe(200);
  });

  it("counts one favourite per account and follows the index", async () => {
    await seedPublished({ owner: USER_ID, versions: ["1.0.0"] });
    const headers = await loginAs("fan@example.com");

    expect((await favorite(headers, ITEM_ID, "PUT")).status).toBe(200);
    expect((await favorite(headers, ITEM_ID, "PUT")).status).toBe(200);
    expect((await indexEntry(ITEM_ID)).favorites).toBe(1);
    expect((await itemFile(ITEM_ID)).favorites).toBe(1);

    const removed = await favorite(headers, ITEM_ID, "DELETE");
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ ok: true, favorites: 0 });
    expect((await indexEntry(ITEM_ID)).favorites).toBe(0);
    expect((await itemFile(ITEM_ID)).favorites).toBe(0);
  });

  it("answers the item's total, not the caller's own count", async () => {
    await seedPublished({ owner: USER_ID, favorites: 2 });
    const headers = await loginAs("second@example.com");

    const response = await favorite(headers, ITEM_ID, "PUT");
    expect(await response.json()).toEqual({ ok: true, favorites: 3 });
    expect((await indexEntry(ITEM_ID)).favorites).toBe(3);
    expect((await favorite(headers, ITEM_ID, "DELETE")).status).toBe(200);
    expect((await indexEntry(ITEM_ID)).favorites).toBe(2);
  });

  it("404s a PUT on an item that is not published but lets a DELETE through", async () => {
    await seedPublished({ owner: USER_ID, status: "draft" });
    const headers = await loginAs("fan@example.com");

    expect((await favorite(headers, ITEM_ID, "PUT")).status).toBe(404);
    const deleted = await favorite(headers, ITEM_ID, "DELETE");
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ ok: true, favorites: 0 });
  });

  it("404s a missing id and 401s without a session", async () => {
    await seedPublished({ owner: USER_ID, versions: ["1.0.0"] });
    const headers = await loginAs("fan@example.com");

    for (const method of ["PUT", "DELETE"] as const) {
      expect((await favorite(headers, MISSING_ID, method)).status).toBe(404);
      expect((await favorite({}, ITEM_ID, method)).status).toBe(401);
    }
  });

  it("keeps a favourite across an unpublish, counting it again on republish", async () => {
    await seedPublished({ owner: USER_ID, versions: ["1.0.0"] });
    const headers = await loginAs("fan@example.com");
    expect((await favorite(headers, ITEM_ID, "PUT")).status).toBe(200);

    await setStatus("unpublished");
    expect(await indexIds()).not.toContain(ITEM_ID);
    expect((await favorite(headers, ITEM_ID, "PUT")).status).toBe(404);

    await setStatus("published");
    expect((await indexEntry(ITEM_ID)).favorites).toBe(1);
  });

  it("counts 150 ids across the 100-parameter chunk boundary", async () => {
    const ids = Array.from(
      { length: 150 },
      (_, index) => `chunk-${String(index).padStart(3, "0")}`,
    );
    await env.DB.prepare(
      "DELETE FROM favorite WHERE item_id LIKE 'chunk-%'",
    ).run();
    // Ids 99 and 100 sit on either side of the 100-parameter chunk boundary and
    // 149 is the last id overall; their distinct counts say which chunk's
    // query produced each answer after the merge.
    const distinct = new Map<number, number>([
      [0, 1],
      [99, 2],
      [100, 3],
      [149, 4],
    ]);
    for (const [index, id] of ids.entries()) {
      for (let row = 0; row < (distinct.get(index) ?? 1); row += 1) {
        await env.DB.prepare(
          "INSERT INTO favorite (user_id, item_id, created_at) VALUES (?, ?, ?)",
        )
          .bind(`fan-${id}-${row}`, id, CREATED_AT)
          .run();
      }
    }

    const counts = await countsByItem(env.DB, ids);

    expect(counts.size).toBe(150);
    expect(counts.get(ids[0]!)).toBe(1);
    expect(counts.get(ids[99]!)).toBe(2);
    expect(counts.get(ids[100]!)).toBe(3);
    expect(counts.get(ids[149]!)).toBe(4);
  });
});

/** Any signed-in account; the user row is created once per pool state. */
async function loginAs(email: string): Promise<Record<string, string>> {
  const context = await createAuth(env).$context;
  const test = (context as unknown as { test: TestHelpers }).test;
  const userId = `user-${email.replace(/[^a-z0-9]/g, "-")}`;
  const existing = await env.DB.prepare("SELECT id FROM user WHERE id = ?")
    .bind(userId)
    .first();
  if (existing === null) {
    await test.saveUser(test.createUser({ id: userId, email }));
  }
  const { headers } = await test.login({ userId });
  return Object.fromEntries(headers.entries());
}

function favorite(
  headers: Record<string, string>,
  itemId: string,
  method: "PUT" | "DELETE",
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/me/items/${itemId}/favorite`, {
    method,
    headers,
  });
}

async function indexEntry(itemId: string): Promise<{ favorites: number }> {
  await clearIndexCache();
  const index = (await (await SELF.fetch(`${BASE}/index.json`)).json()) as {
    entries: { id: string; favorites: number }[];
  };
  const entry = index.entries.find((candidate) => candidate.id === itemId);
  if (entry === undefined) throw new Error(`No index entry for ${itemId}.`);
  return entry;
}

async function itemFile(itemId: string): Promise<{ favorites: number }> {
  return (await (
    await SELF.fetch(`${BASE}/catalogue/${itemId}/item.json`)
  ).json()) as { favorites: number };
}

function setStatus(status: "published" | "unpublished"): Promise<unknown> {
  return env.DB.prepare("UPDATE item SET status = ? WHERE id = ?")
    .bind(status, ITEM_ID)
    .run();
}
