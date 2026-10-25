import { env, SELF } from "cloudflare:test";
import type { TestHelpers } from "better-auth/plugins";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createAuth } from "../src/auth";
import { isOwner } from "../src/auth/owner";
import { handleAdmin } from "../src/routes/admin";
import { MAX_JSON_BODY } from "../src/routes/body";
import { BASE, candidate, countingEnv, listingStatements } from "./helpers";
import { ITEM_ID, seedItem, statusOf } from "./seed";

const OWNER_ID = "user-admin-owner";
const OWNER_EMAIL = "owner@example.com";
const AUTHOR_ID = "user-admin-author";
const AUTHOR_EMAIL = "author-admin@example.com";
const OTHER_ID = "10000000-0000-4000-8000-000000000002";
const PUBLISHED_ID = "10000000-0000-4000-8000-000000000003";
const GHOST_ID = "no-such-account";
const BLANK_ID = "user-admin-blank";
const BLANK_EMAIL = "blank@example.com";
const CREATED_AT = "2026-10-01T00:00:00.000Z";
const OLDER_AT = "2026-09-30T00:00:00.000Z";

describe("admin", () => {
  beforeAll(async () => {
    // Better Auth owns `user`; only `/migrate` creates it.
    const migrated = await SELF.fetch(`${BASE}/migrate`, {
      method: "POST",
      headers: { "x-migrate-token": "test-migrate" },
    });
    expect(migrated.status).toBe(200);
  });

  it("matches owner emails case-insensitively over a comma-separated secret", () => {
    const session = {
      userId: "u",
      email: "Owner@Example.com",
      emailVerified: true,
    };
    expect(isOwner(session, "owner@example.com")).toBe(true);
    expect(isOwner(session, " someone@example.com , OWNER@EXAMPLE.COM ")).toBe(
      true,
    );
    expect(isOwner(session, "owner@example.com.evil")).toBe(false);
    expect(isOwner(session, "other@example.com")).toBe(false);
    // An empty secret matches nobody, not everybody.
    expect(isOwner(session, "")).toBe(false);
    expect(isOwner(session, " , ")).toBe(false);
    // An unverified address is not a claim to the allow-list entry.
    expect(
      isOwner({ ...session, emailVerified: false }, "owner@example.com"),
    ).toBe(false);
    // Neither does a session with no email: comparing blanks would let a
    // whitespace-only secret admit the session.
    expect(
      isOwner({ userId: "u", email: "", emailVerified: true }, " , "),
    ).toBe(false);
    expect(
      isOwner({ userId: "u", email: "   ", emailVerified: true }, ""),
    ).toBe(false);
  });

  it("404s an unverified account whose email is on the owner list", async () => {
    const unverified = await loginAs(OWNER_ID, OWNER_EMAIL, false);
    expect((await admin(unverified, "queue")).status).toBe(404);
  });

  it("401s without a session and 404s an authenticated non-owner", async () => {
    const author = await loginAs(AUTHOR_ID, AUTHOR_EMAIL);
    await seedItem(ITEM_ID, AUTHOR_ID, { status: "pending" });

    expect((await admin(author, "queue")).status).toBe(404);
    expect((await admin(author, `items/${ITEM_ID}/approve`)).status).toBe(404);
    // Body-less POSTs still reach the owner check, never a 400.
    expect((await admin(author, `items/${ITEM_ID}/remove`)).status).toBe(404);
    expect((await admin(author, `items/${ITEM_ID}/restore`)).status).toBe(404);
    expect((await admin(author, `authors/${AUTHOR_ID}/verify`)).status).toBe(
      404,
    );

    for (const path of [
      "queue",
      `items/${ITEM_ID}/approve`,
      `items/${ITEM_ID}/remove`,
      `items/${ITEM_ID}/restore`,
      `authors/${AUTHOR_ID}/verify`,
    ]) {
      // The queue is the one GET; the rest are POST-only.
      const method = path === "queue" ? "GET" : "POST";
      expect(
        (await SELF.fetch(`${BASE}/api/admin/${path}`, { method })).status,
      ).toBe(401);
      expect(
        (
          await SELF.fetch(`${BASE}/api/admin/${path}`, {
            method,
            headers: { authorization: "Bearer forged.token" },
          })
        ).status,
      ).toBe(401);
    }

    // Anti-enumeration: an anonymous caller cannot learn an item id is missing.
    expect(
      (
        await SELF.fetch(`${BASE}/api/admin/items/no-such-item/approve`, {
          method: "POST",
        })
      ).status,
    ).toBe(401);
  });

  it("404s a session with no email even on a whitespace-only secret", async () => {
    await loginAs(BLANK_ID, BLANK_EMAIL);
    // Better Auth validates the email, so blank the joined row instead; the
    // session reads its user fresh on every request.
    await env.DB.prepare('UPDATE "user" SET email = ? WHERE id = ?')
      .bind("", BLANK_ID)
      .run();
    const session = await loginAs(BLANK_ID, BLANK_EMAIL);

    const original = env.OWNER_EMAILS;
    env.OWNER_EMAILS = " , ";
    try {
      expect(env.OWNER_EMAILS).toBe(" , ");
      expect((await admin(session, "queue")).status).toBe(404);
      expect((await admin(session, `items/${ITEM_ID}/approve`)).status).toBe(
        404,
      );
    } finally {
      env.OWNER_EMAILS = original;
      await env.DB.prepare('UPDATE "user" SET email = ? WHERE id = ?')
        .bind(BLANK_EMAIL, BLANK_ID)
        .run();
    }
  });

  it("lets only an owner approve a pending item", async () => {
    const author = await loginAs(AUTHOR_ID, AUTHOR_EMAIL);
    const owner = await loginAs(OWNER_ID, OWNER_EMAIL);
    await seedItem(ITEM_ID, AUTHOR_ID, { status: "pending" });

    expect(
      (
        await SELF.fetch(`${BASE}/api/admin/items/${ITEM_ID}/approve`, {
          method: "POST",
          headers: author,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await SELF.fetch(`${BASE}/api/admin/items/${ITEM_ID}/approve`, {
          method: "POST",
          headers: owner,
        })
      ).status,
    ).toBe(200);
    expect(await statusOf(env.DB, ITEM_ID)).toBe("published");
    expect(await publishedAt(ITEM_ID)).not.toBeNull();
  });

  it("409s the guarded transition, naming the current status", async () => {
    const owner = await loginAs(OWNER_ID, OWNER_EMAIL);
    await seedItem(ITEM_ID, AUTHOR_ID, { status: "published" });

    const stale = await admin(owner, `items/${ITEM_ID}/approve`);
    expect(stale.status).toBe(409);
    expect(await stale.text()).toContain("published");
    expect(await statusOf(env.DB, ITEM_ID)).toBe("published");

    expect((await admin(owner, "items/no-such-item/approve")).status).toBe(404);
    // A missing row is 404 before the reason is even looked at.
    expect((await admin(owner, "items/no-such-item/remove")).status).toBe(404);
    expect(
      (
        await admin(
          owner,
          "items/no-such-item/remove",
          JSON.stringify({ reason: "Gone" }),
        )
      ).status,
    ).toBe(404);
  });

  it("lets exactly one of two concurrent approves win", async () => {
    const owner = await loginAs(OWNER_ID, OWNER_EMAIL);
    await seedItem(ITEM_ID, AUTHOR_ID, { status: "pending" });

    const [first, second] = await Promise.all([
      admin(owner, `items/${ITEM_ID}/approve`),
      admin(owner, `items/${ITEM_ID}/approve`),
    ]);
    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([
      200, 409,
    ]);
    expect(await statusOf(env.DB, ITEM_ID)).toBe("published");
  });

  it("rejects with a trimmed reason and refuses an empty or oversized one", async () => {
    const owner = await loginAs(OWNER_ID, OWNER_EMAIL);
    await seedItem(ITEM_ID, AUTHOR_ID, { status: "pending" });

    const path = `items/${ITEM_ID}/reject`;
    for (const body of [
      "",
      "not json",
      "{}",
      JSON.stringify({ reason: 42 }),
      JSON.stringify({ reason: "   " }),
      JSON.stringify({ reason: "x".repeat(501) }),
    ]) {
      expect((await admin(owner, path, body)).status).toBe(400);
      expect(await statusOf(env.DB, ITEM_ID)).toBe("pending");
    }

    expect(
      (await admin(owner, path, JSON.stringify({ reason: "  Spam links  " })))
        .status,
    ).toBe(200);
    expect(await statusOf(env.DB, ITEM_ID)).toBe("rejected");
    expect(await reasonOf(ITEM_ID)).toBe("Spam links");

    // Rejecting again has no `pending` row to guard.
    expect(
      (await admin(owner, path, JSON.stringify({ reason: "Again" }))).status,
    ).toBe(409);
  });

  it("refuses an oversized reason body without parsing it", async () => {
    const owner = await loginAs(OWNER_ID, OWNER_EMAIL);
    await seedItem(ITEM_ID, AUTHOR_ID, { status: "pending" });

    const body = JSON.stringify({ reason: "x".repeat(MAX_JSON_BODY) });
    const parseSpy = vi.spyOn(JSON, "parse");
    try {
      const response = await admin(owner, `items/${ITEM_ID}/reject`, body);
      expect(response.status).toBe(413);
      expect(parseSpy.mock.calls.some(([text]) => text === body)).toBe(false);
    } finally {
      parseSpy.mockRestore();
    }
    expect(await statusOf(env.DB, ITEM_ID)).toBe("pending");

    // A reason inside the cap still reaches the status machine.
    expect(
      (
        await admin(
          owner,
          `items/${ITEM_ID}/reject`,
          JSON.stringify({ reason: "Spam" }),
        )
      ).status,
    ).toBe(200);
    expect(await statusOf(env.DB, ITEM_ID)).toBe("rejected");
  });

  it("hides an admin route from a non-owner before reading its body", async () => {
    const author = await loginAs(AUTHOR_ID, AUTHOR_EMAIL);
    await seedItem(ITEM_ID, AUTHOR_ID, { status: "pending" });

    // The session and owner gate run first: an oversized body that would be
    // 413 for an owner answers 404 here, and no body is read at all.
    const body = JSON.stringify({ reason: "x".repeat(MAX_JSON_BODY) });
    const parseSpy = vi.spyOn(JSON, "parse");
    try {
      const response = await admin(author, `items/${ITEM_ID}/reject`, body);
      expect(response.status).toBe(404);
      expect(parseSpy.mock.calls.some(([text]) => text === body)).toBe(false);
    } finally {
      parseSpy.mockRestore();
    }
    expect(await statusOf(env.DB, ITEM_ID)).toBe("pending");
  });

  it("removes with a reason and restores, clearing the reason", async () => {
    const owner = await loginAs(OWNER_ID, OWNER_EMAIL);
    const author = await loginAs(AUTHOR_ID, AUTHOR_EMAIL);
    await seedItem(ITEM_ID, AUTHOR_ID, { status: "published" });

    expect(
      (
        await admin(
          owner,
          `items/${ITEM_ID}/remove`,
          JSON.stringify({ reason: "Broken preview" }),
        )
      ).status,
    ).toBe(200);
    expect(await statusOf(env.DB, ITEM_ID)).toBe("removed");
    expect(await reasonOf(ITEM_ID)).toBe("Broken preview");
    expect(await removedAt(ITEM_ID)).not.toBeNull();

    // The author cannot write over a takedown: a new version is refused 409.
    const resubmit = await SELF.fetch(
      `${BASE}/api/me/items/${ITEM_ID}/versions`,
      {
        method: "POST",
        headers: { ...author, "content-type": "application/json" },
        body: JSON.stringify({
          envelope: candidate(ITEM_ID),
          name: "Mine",
        }),
      },
    );
    expect(resubmit.status).toBe(409);
    expect(await resubmit.text()).toBe("Broken preview");

    expect((await admin(owner, `items/${ITEM_ID}/restore`)).status).toBe(200);
    expect(await statusOf(env.DB, ITEM_ID)).toBe("published");
    // The stale sentence must not survive a restore.
    expect(await reasonOf(ITEM_ID)).toBeNull();

    // A second restore has no `removed` row to guard.
    const again = await admin(owner, `items/${ITEM_ID}/restore`);
    expect(again.status).toBe(409);
    expect(await again.text()).toContain("published");
  });

  it("removes a pending item and refuses a draft", async () => {
    const owner = await loginAs(OWNER_ID, OWNER_EMAIL);
    const body = JSON.stringify({ reason: "Never mind" });

    await seedItem(ITEM_ID, AUTHOR_ID, { status: "pending" });
    expect((await admin(owner, `items/${ITEM_ID}/remove`, body)).status).toBe(
      200,
    );
    expect(await statusOf(env.DB, ITEM_ID)).toBe("removed");

    await seedItem(ITEM_ID, AUTHOR_ID, { status: "draft" });
    const refused = await admin(owner, `items/${ITEM_ID}/remove`, body);
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain("draft");
  });

  it("lists the pending queue oldest first with email and latest version", async () => {
    const owner = await loginAs(OWNER_ID, OWNER_EMAIL);
    await loginAs(AUTHOR_ID, AUTHOR_EMAIL);
    await seedItem(ITEM_ID, AUTHOR_ID, { status: "pending" });
    await seedItem(OTHER_ID, AUTHOR_ID, { status: "pending" });
    await seedItem(PUBLISHED_ID, AUTHOR_ID, { status: "published" });
    await env.DB.prepare(
      "UPDATE item SET created_at = ?, updated_at = ? WHERE id = ?",
    )
      .bind(OLDER_AT, OLDER_AT, OTHER_ID)
      .run();
    await addVersion(ITEM_ID, "1.0.0");
    await addVersion(ITEM_ID, "1.1.0");

    const response = await admin(owner, "queue");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      entries: [
        {
          id: OTHER_ID,
          name: "Seeded theme",
          authorUserId: AUTHOR_ID,
          authorEmail: AUTHOR_EMAIL,
          createdAt: OLDER_AT,
          updatedAt: OLDER_AT,
          version: null,
          status: "pending",
        },
        {
          id: ITEM_ID,
          name: "Seeded theme",
          authorUserId: AUTHOR_ID,
          authorEmail: AUTHOR_EMAIL,
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
          version: "1.1.0",
          status: "pending",
        },
      ],
    });
    // The owner secret is never echoed.
    expect(await (await admin(owner, "queue")).text()).not.toContain(
      OWNER_EMAIL,
    );
  });

  it("reads a 50-item queue in one statement, oldest first with emails", async () => {
    const owner = await loginAs(OWNER_ID, OWNER_EMAIL);
    await loginAs(AUTHOR_ID, AUTHOR_EMAIL);
    // Rows another case left pending are not this case's queue.
    await env.DB.prepare(
      "DELETE FROM item_version WHERE item_id IN (SELECT id FROM item WHERE status = 'pending')",
    ).run();
    await env.DB.prepare("DELETE FROM item WHERE status = 'pending'").run();

    const ids = Array.from(
      { length: 50 },
      (_, index) =>
        `32000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
    );
    const instant = (index: number): string =>
      new Date(Date.UTC(2026, 9, 1, 0, 0, index)).toISOString();
    for (const [index, id] of ids.entries()) {
      await seedItem(id, AUTHOR_ID, { status: "pending" });
      await env.DB.prepare(
        "UPDATE item SET created_at = ?, updated_at = ? WHERE id = ?",
      )
        .bind(instant(index), instant(index), id)
        .run();
    }

    const queries: string[] = [];
    const path = `${BASE}/api/admin/queue`;
    const response = await handleAdmin(
      new Request(path, { headers: owner }),
      countingEnv(queries),
      new URL(path),
    );
    if (response === undefined)
      throw new Error("The queue route did not answer.");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      readonly entries: readonly {
        readonly id: string;
        readonly authorEmail: string | null;
      }[];
    };

    // One statement: the item, its latest version and the author ride it.
    expect(listingStatements(queries)).toHaveLength(1);
    expect(body.entries.map((entry) => entry.id)).toEqual(ids);
    expect(
      body.entries.every((entry) => entry.authorEmail === AUTHOR_EMAIL),
    ).toBe(true);
  });

  it("verifies and unverifies an author, keeping the display name", async () => {
    const owner = await loginAs(OWNER_ID, OWNER_EMAIL);
    await clearProfile(AUTHOR_ID);

    const verified = await admin(owner, `authors/${AUTHOR_ID}/verify`);
    expect(verified.status).toBe(200);
    const verifiedBody = await verified.text();
    expect(JSON.parse(verifiedBody)).toEqual({
      ok: true,
      userId: AUTHOR_ID,
      verified: true,
    });
    // The account's email never rides along on the answer.
    expect(verifiedBody).not.toContain(AUTHOR_EMAIL);
    expect(await profileOf(AUTHOR_ID)).toEqual({
      verified: 1,
      display_name: null,
    });

    await env.DB.prepare(
      "UPDATE author_profile SET display_name = ? WHERE user_id = ?",
    )
      .bind("Huy", AUTHOR_ID)
      .run();
    const unverified = await admin(owner, `authors/${AUTHOR_ID}/unverify`);
    expect(unverified.status).toBe(200);
    const unverifiedBody = await unverified.text();
    expect(JSON.parse(unverifiedBody)).toEqual({
      ok: true,
      userId: AUTHOR_ID,
      verified: false,
    });
    expect(unverifiedBody).not.toContain(AUTHOR_EMAIL);
    expect(await profileOf(AUTHOR_ID)).toEqual({
      verified: 0,
      display_name: "Huy",
    });

    // An id with no Better Auth account is allowed: the owner may verify ahead
    // of a first sign-in.
    await clearProfile(GHOST_ID);
    expect((await admin(owner, `authors/${GHOST_ID}/verify`)).status).toBe(200);
    expect((await profileOf(GHOST_ID))?.verified).toBe(1);
    await clearProfile(GHOST_ID);
  });
});

/**
 * The account is created once; a second call reuses the row and applies the
 * requested verification state, so a later attestation never depends on order.
 */
async function loginAs(
  userId: string,
  email: string,
  emailVerified = true,
): Promise<Record<string, string>> {
  const test = await testHelpers();
  const existing = await env.DB.prepare('SELECT id FROM "user" WHERE id = ?')
    .bind(userId)
    .first();
  if (existing === null)
    await test.saveUser(test.createUser({ id: userId, email, emailVerified }));
  else
    await env.DB.prepare('UPDATE "user" SET emailVerified = ? WHERE id = ?')
      .bind(emailVerified ? 1 : 0, userId)
      .run();
  const { headers } = await test.login({ userId });
  return Object.fromEntries(headers.entries());
}

async function testHelpers(): Promise<TestHelpers> {
  const context = await createAuth(env).$context;
  return (context as unknown as { test: TestHelpers }).test;
}

/** GETs the queue, or POSTs a path with an optional raw body. */
async function admin(
  headers: Record<string, string>,
  path: string,
  body?: string,
): Promise<Response> {
  if (body === undefined && path === "queue")
    return SELF.fetch(`${BASE}/api/admin/queue`, { headers });
  return SELF.fetch(`${BASE}/api/admin/${path}`, {
    method: "POST",
    headers: {
      ...headers,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body }),
  });
}

async function addVersion(itemId: string, version: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO item_version (item_id, version, envelope_json, facets_json,
       package_key, thumbnail_key, bytes, sha256, created_at)
     VALUES (?, ?, '{}', '{}', ?, ?, 1, ?, ?)`,
  )
    .bind(
      itemId,
      version,
      `packages/${itemId}/${version}.zip`,
      `catalogue/${itemId}/thumbnail.png`,
      "0".repeat(64),
      CREATED_AT,
    )
    .run();
}

async function clearProfile(userId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM author_profile WHERE user_id = ?")
    .bind(userId)
    .run();
}

async function profileOf(
  userId: string,
): Promise<{ verified: number; display_name: string | null } | null> {
  return env.DB.prepare(
    "SELECT verified, display_name FROM author_profile WHERE user_id = ?",
  )
    .bind(userId)
    .first<{ verified: number; display_name: string | null }>();
}

async function reasonOf(itemId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT status_reason FROM item WHERE id = ?",
  )
    .bind(itemId)
    .first<{ status_reason: string | null }>();
  return row?.status_reason ?? null;
}

async function publishedAt(itemId: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT published_at FROM item WHERE id = ?")
    .bind(itemId)
    .first<{ published_at: string | null }>();
  return row?.published_at ?? null;
}

async function removedAt(itemId: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT removed_at FROM item WHERE id = ?")
    .bind(itemId)
    .first<{ removed_at: string | null }>();
  return row?.removed_at ?? null;
}
