import { env, SELF } from "cloudflare:test";
import type { CatalogueStatus } from "@yunari/renderer-core";
import type { TestHelpers } from "better-auth/plugins";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAuth } from "../src/auth";
import { REPORT_LIMIT } from "../src/db/reports";
import { BASE } from "./helpers";
import { ITEM_ID, seedPublished, statusOf } from "./seed";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

describe("reports", () => {
  beforeAll(async () => {
    // Better Auth owns `user` and `session`; only `/migrate` creates them.
    const migrated = await SELF.fetch(`${BASE}/migrate`, {
      method: "POST",
      headers: { "x-migrate-token": "test-migrate" },
    });
    expect(migrated.status).toBe(200);
  });

  beforeEach(async () => {
    // The pool keeps D1 rows between tests in one file; every report test
    // starts from an empty intake, and the reported item is reseeded by it.
    await env.DB.prepare("DELETE FROM report").run();
  });

  it("records a signed-in account's report of a published item", async () => {
    await seedPublished();
    const author = await loginAs("reporter@example.com");

    const response = await report(author.headers, ITEM_ID, {
      category: "harassment",
      note: "  targets a specific person  ",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    expect(await reports()).toEqual([
      {
        user_id: author.userId,
        item_id: ITEM_ID,
        category: "harassment",
        note: "targets a specific person",
      },
    ]);
    // Intake only: the target stays exactly as published.
    expect(await statusOf(env.DB, ITEM_ID)).toBe("published");
  });

  it("accepts a report with no note", async () => {
    await seedPublished();
    const author = await loginAs("quiet@example.com");

    expect(
      (await report(author.headers, ITEM_ID, { category: "spam" })).status,
    ).toBe(200);
    expect((await reports())[0]?.note).toBeNull();
  });

  it("collapses duplicate reports from one account onto one row", async () => {
    await seedPublished();
    const author = await loginAs("duplicate@example.com");

    expect(
      (
        await report(author.headers, ITEM_ID, {
          category: "spam",
          note: "first",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await report(author.headers, ITEM_ID, {
          category: "violence",
          note: "second",
        })
      ).status,
    ).toBe(200);

    const rows = await reports();
    expect(rows).toHaveLength(1);
    // The first report is the one kept; a repeat is not an edit.
    expect(rows[0]?.category).toBe("spam");
    expect(rows[0]?.note).toBe("first");
  });

  it("keeps one row per account reporting the same item", async () => {
    await seedPublished();
    const first = await loginAs("first-reporter@example.com");
    const second = await loginAs("second-reporter@example.com");

    expect(
      (await report(first.headers, ITEM_ID, { category: "spam" })).status,
    ).toBe(200);
    expect(
      (await report(second.headers, ITEM_ID, { category: "spam" })).status,
    ).toBe(200);
    expect(await reports()).toHaveLength(2);
  });

  it("rate-limits an account to the trailing-hour budget", async () => {
    await seedPublished();
    const author = await loginAs("rate-limited@example.com");
    await seedReports(author.userId, REPORT_LIMIT, true);

    expect(
      (await report(author.headers, ITEM_ID, { category: "spam" })).status,
    ).toBe(429);

    // Free one slot: the next report fits.
    await env.DB.prepare("DELETE FROM report WHERE user_id = ? AND item_id = ?")
      .bind(author.userId, "old-report")
      .run();
    expect(
      (await report(author.headers, ITEM_ID, { category: "spam" })).status,
    ).toBe(200);
  });

  it("answers a repeat on an already-reported item even at the limit", async () => {
    await seedPublished();
    const author = await loginAs("repeat-at-limit@example.com");

    expect(
      (await report(author.headers, ITEM_ID, { category: "spam" })).status,
    ).toBe(200);
    await seedReports(author.userId, REPORT_LIMIT, true);

    // The row already exists, so a repeat costs no budget: the caller is
    // answered from it rather than told to wait an hour for a no-op.
    expect(
      (await report(author.headers, ITEM_ID, { category: "spam" })).status,
    ).toBe(200);
    expect(await reports()).toHaveLength(REPORT_LIMIT + 1);
  });

  it("counts only the trailing hour, not an older report", async () => {
    await seedPublished();
    const author = await loginAs("old-reports@example.com");
    await seedReports(author.userId, REPORT_LIMIT, false);

    expect(
      (await report(author.headers, ITEM_ID, { category: "spam" })).status,
    ).toBe(200);
  });

  it("refuses every target that is not published", async () => {
    const author = await loginAs("unpublished@example.com");
    const statuses: readonly CatalogueStatus[] = [
      "draft",
      "pending",
      "unpublished",
      "rejected",
      "removed",
    ];

    for (const status of statuses) {
      await seedPublished({ status });
      expect(
        (await report(author.headers, ITEM_ID, { category: "spam" })).status,
        status,
      ).toBe(404);
      expect(await statusOf(env.DB, ITEM_ID)).toBe(status);
    }
    expect(await reports()).toHaveLength(0);
  });

  it("404s a missing item and 401s without a session", async () => {
    await seedPublished();
    const author = await loginAs("missing@example.com");

    expect(
      (await report(author.headers, MISSING_ID, { category: "spam" })).status,
    ).toBe(404);
    expect((await report({}, ITEM_ID, { category: "spam" })).status).toBe(401);
    expect(await reports()).toHaveLength(0);
  });

  it("refuses a category outside the closed set and a malformed note", async () => {
    await seedPublished();
    const author = await loginAs("hostile@example.com");

    const bodies: readonly Record<string, unknown>[] = [
      {},
      { category: "not-a-category" },
      { category: 7 },
      { category: "spam", note: 7 },
      { category: "spam", note: "x".repeat(1001) },
    ];
    for (const body of bodies) {
      expect(
        (await report(author.headers, ITEM_ID, body)).status,
        JSON.stringify(body),
      ).toBe(400);
    }
    expect(await reports()).toHaveLength(0);
  });
});

/** Any signed-in account; the user row is created once per pool state. */
async function loginAs(
  email: string,
): Promise<{ headers: Record<string, string>; userId: string }> {
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
  return { headers: Object.fromEntries(headers.entries()), userId };
}

function report(
  headers: Record<string, string>,
  itemId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/me/items/${itemId}/report`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Rows in write order, so a dedupe test reads what was kept first. */
async function reports(): Promise<
  {
    user_id: string;
    item_id: string;
    category: string;
    note: string | null;
  }[]
> {
  const result = await env.DB.prepare(
    "SELECT user_id, item_id, category, note FROM report ORDER BY rowid",
  ).all<{
    user_id: string;
    item_id: string;
    category: string;
    note: string | null;
  }>();
  return result.results;
}

/**
 * Distinct prior reports for one account. `withinWindow` picks whether they
 * count against the hourly budget.
 */
async function seedReports(
  userId: string,
  count: number,
  withinWindow: boolean,
): Promise<void> {
  const at = new Date(
    Date.now() - (withinWindow ? 60_000 : 2 * 60 * 60 * 1000),
  ).toISOString();
  for (let index = 0; index < count; index += 1) {
    await env.DB.prepare(
      `INSERT INTO report (user_id, item_id, category, note, created_at)
       VALUES (?, ?, 'spam', NULL, ?)`,
    )
      .bind(userId, index === 0 ? "old-report" : `prior-${index}`, at)
      .run();
  }
}
