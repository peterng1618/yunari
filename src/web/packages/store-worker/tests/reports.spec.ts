import { env, SELF } from "cloudflare:test";
import type { CatalogueStatus } from "@yunari/renderer-core";
import type { TestHelpers } from "better-auth/plugins";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAuth } from "../src/auth";
import { REPORT_LIMIT } from "../src/db/reports";
import { BASE } from "./helpers";
import { ITEM_ID, seedItem, seedPublished, statusOf } from "./seed";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";
const OTHER_ID = "10000000-0000-4000-8000-000000000004";
const OWNER_EMAIL = "owner@example.com";

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

  it("lists open reports oldest first with a per-item count", async () => {
    const owner = await loginAs(OWNER_EMAIL);
    await seedPublished();
    await seedItem(OTHER_ID, "user-other-author", { status: "published" });
    await seedReport("reporter-a", ITEM_ID, {
      category: "spam",
      note: "first",
      at: "2026-10-02T00:00:00.000Z",
    });
    await seedReport("reporter-b", ITEM_ID, {
      category: "harassment",
      at: "2026-10-03T00:00:00.000Z",
    });
    await seedReport("reporter-c", OTHER_ID, {
      category: "violence",
      at: "2026-10-01T00:00:00.000Z",
    });
    // A closed report is neither listed nor counted.
    await seedReport("reporter-d", OTHER_ID, {
      at: "2026-10-04T00:00:00.000Z",
      status: "resolved",
    });

    const response = await admin(owner.headers, "reports");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      entries: [
        {
          itemId: OTHER_ID,
          itemName: "Seeded theme",
          itemStatus: "published",
          reporterUserId: "reporter-c",
          category: "violence",
          note: null,
          createdAt: "2026-10-01T00:00:00.000Z",
          openReports: 1,
        },
        {
          itemId: ITEM_ID,
          itemName: "Yunari smoke theme",
          itemStatus: "published",
          reporterUserId: "reporter-a",
          category: "spam",
          note: "first",
          createdAt: "2026-10-02T00:00:00.000Z",
          openReports: 2,
        },
        {
          itemId: ITEM_ID,
          itemName: "Yunari smoke theme",
          itemStatus: "published",
          reporterUserId: "reporter-b",
          category: "harassment",
          note: null,
          createdAt: "2026-10-03T00:00:00.000Z",
          openReports: 2,
        },
      ],
    });
  });

  it("resolves or dismisses one report, recording the verdict", async () => {
    const owner = await loginAs(OWNER_EMAIL);
    await seedPublished();
    await seedReport("reporter-a", ITEM_ID);
    await seedReport("reporter-b", ITEM_ID);

    const resolved = await admin(
      owner.headers,
      `reports/reporter-a/${ITEM_ID}/resolve`,
    );
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toEqual({ ok: true, status: "resolved" });

    const dismissed = await admin(
      owner.headers,
      `reports/reporter-b/${ITEM_ID}/dismiss`,
    );
    expect(dismissed.status).toBe(200);
    expect(await dismissed.json()).toEqual({ ok: true, status: "dismissed" });

    expect(await verdicts(ITEM_ID)).toEqual([
      {
        user_id: "reporter-a",
        status: "resolved",
        outcome: null,
        resolved: true,
      },
      {
        user_id: "reporter-b",
        status: "dismissed",
        outcome: null,
        resolved: true,
      },
    ]);

    // A closed report is not closed twice; a missing one is still a 404.
    const again = await admin(
      owner.headers,
      `reports/reporter-a/${ITEM_ID}/resolve`,
    );
    expect(again.status).toBe(409);
    expect(await again.text()).toContain("resolved");
    expect(
      (await admin(owner.headers, `reports/ghost/${ITEM_ID}/dismiss`)).status,
    ).toBe(404);
  });

  it("resolves every open report on removal with the removal reason", async () => {
    const owner = await loginAs(OWNER_EMAIL);
    await seedPublished();
    await seedItem(OTHER_ID, "user-other-author", { status: "published" });
    await seedReport("reporter-a", ITEM_ID);
    await seedReport("reporter-b", ITEM_ID);
    await seedReport("reporter-c", OTHER_ID);

    const response = await admin(
      owner.headers,
      `items/${ITEM_ID}/remove`,
      JSON.stringify({ reason: "  Broken preview  " }),
    );
    expect(response.status).toBe(200);
    expect(await statusOf(env.DB, ITEM_ID)).toBe("removed");

    // Both reports on the removed item carry the trimmed reason; the other
    // item's report is untouched.
    expect(await verdicts(ITEM_ID)).toEqual([
      {
        user_id: "reporter-a",
        status: "resolved",
        outcome: "Broken preview",
        resolved: true,
      },
      {
        user_id: "reporter-b",
        status: "resolved",
        outcome: "Broken preview",
        resolved: true,
      },
    ]);
    expect(await verdicts(OTHER_ID)).toEqual([
      {
        user_id: "reporter-c",
        status: "open",
        outcome: null,
        resolved: false,
      },
    ]);
  });

  it("leaves reports open when the removal transition is refused", async () => {
    const owner = await loginAs(OWNER_EMAIL);
    await seedPublished({ status: "draft" });
    await seedReport("reporter-a", ITEM_ID);

    const refused = await admin(
      owner.headers,
      `items/${ITEM_ID}/remove`,
      JSON.stringify({ reason: "Broken" }),
    );
    expect(refused.status).toBe(409);
    expect(await verdicts(ITEM_ID)).toEqual([
      {
        user_id: "reporter-a",
        status: "open",
        outcome: null,
        resolved: false,
      },
    ]);
  });
});

/** Any signed-in account; the user row is created once per pool state. */
async function loginAs(
  email: string,
  emailVerified = true,
): Promise<{ headers: Record<string, string>; userId: string }> {
  const context = await createAuth(env).$context;
  const test = (context as unknown as { test: TestHelpers }).test;
  const userId = `user-${email.replace(/[^a-z0-9]/g, "-")}`;
  const existing = await env.DB.prepare("SELECT id FROM user WHERE id = ?")
    .bind(userId)
    .first();
  if (existing === null) {
    await test.saveUser(test.createUser({ id: userId, email, emailVerified }));
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

/** GETs the report queue, or POSTs an admin path with an optional body. */
async function admin(
  headers: Record<string, string>,
  path: string,
  body?: string,
): Promise<Response> {
  if (body === undefined && path === "reports")
    return SELF.fetch(`${BASE}/api/admin/reports`, { headers });
  return SELF.fetch(`${BASE}/api/admin/${path}`, {
    method: "POST",
    headers: {
      ...headers,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body }),
  });
}

interface SeedReportOptions {
  readonly at?: string;
  readonly category?: string;
  readonly note?: string | null;
  readonly status?: "open" | "resolved" | "dismissed";
}

/** One report row in a named triage state; the caller clears the table first. */
async function seedReport(
  userId: string,
  itemId: string,
  options: SeedReportOptions = {},
): Promise<void> {
  const status = options.status ?? "open";
  const at = options.at ?? "2026-10-01T00:00:00.000Z";
  await env.DB.prepare(
    `INSERT INTO report (user_id, item_id, category, note, created_at,
       status, outcome, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
  )
    .bind(
      userId,
      itemId,
      options.category ?? "spam",
      options.note ?? null,
      at,
      status,
      status === "open" ? null : at,
    )
    .run();
}

/** One item's report verdicts, ordered by reporter so a test can name them. */
async function verdicts(itemId: string): Promise<
  {
    user_id: string;
    status: string;
    outcome: string | null;
    resolved: boolean;
  }[]
> {
  const result = await env.DB.prepare(
    `SELECT user_id, status, outcome, resolved_at IS NOT NULL AS resolved
     FROM report WHERE item_id = ? ORDER BY user_id`,
  )
    .bind(itemId)
    .all<{
      user_id: string;
      status: string;
      outcome: string | null;
      resolved: number;
    }>();
  return result.results.map((row) => ({
    user_id: row.user_id,
    status: row.status,
    outcome: row.outcome,
    resolved: row.resolved === 1,
  }));
}
