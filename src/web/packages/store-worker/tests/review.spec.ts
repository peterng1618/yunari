import { env, SELF } from "cloudflare:test";
import type { TestHelpers } from "better-auth/plugins";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAuth } from "../src/auth";
import { BASE, sessionHeaders } from "./helpers";
import { ITEM_ID, statusOf } from "./seed";
import {
  finalize,
  itemRow,
  pluginPackage,
  reset,
  submit,
  verifyAuthor,
  versionReviewState,
} from "./packs-submit";

const OWNER_ID = "user-review-owner";
const OWNER_EMAIL = "owner@example.com";

/** A plugin that asks for a serial device, which is the review trigger. */
function hardwarePlugin(): Uint8Array {
  return pluginPackage({ capabilities: ["serial:device"] });
}

async function ownerHeaders(): Promise<Record<string, string>> {
  const context = await createAuth(env).$context;
  const test = (context as unknown as { test: TestHelpers }).test;
  const existing = await env.DB.prepare('SELECT id FROM "user" WHERE id = ?')
    .bind(OWNER_ID)
    .first();
  if (existing === null)
    await test.saveUser(
      test.createUser({
        id: OWNER_ID,
        email: OWNER_EMAIL,
        emailVerified: true,
      }),
    );
  const { headers } = await test.login({ userId: OWNER_ID });
  return Object.fromEntries(headers.entries());
}

function review(
  headers: Record<string, string>,
  body: unknown,
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/admin/items/${ITEM_ID}/review`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("hardware review", () => {
  beforeAll(async () => {
    const migrated = await SELF.fetch(`${BASE}/migrate`, {
      method: "POST",
      headers: { "x-migrate-token": "test-migrate" },
    });
    expect(migrated.status).toBe(200);
  });

  beforeEach(reset);

  it("holds a hardware plugin for review even for a verified author", async () => {
    const headers = await sessionHeaders();
    await verifyAuthor("acme");
    const { version } = await submit(headers, hardwarePlugin(), "plugin");

    const response = await finalize(headers, version);
    expect(response.status, await response.clone().text()).toBe(200);
    const row = await itemRow();
    expect(row.status).toBe("pending");
    expect(row.review_state).toBe("pending");
    expect(await versionReviewState(version)).toBe("pending");
  });

  it("publishes only when the owner approves", async () => {
    const headers = await sessionHeaders();
    await verifyAuthor("acme");
    const { version } = await submit(headers, hardwarePlugin(), "plugin");
    await finalize(headers, version);

    const owner = await ownerHeaders();
    const approved = await review(owner, { decision: "approved" });
    expect(approved.status).toBe(200);
    expect(await statusOf(env.DB, ITEM_ID)).toBe("published");
    expect(await itemRow()).toMatchObject({
      status: "published",
      review_state: "approved",
    });
    expect(await versionReviewState(version)).toBe("approved");

    // A second verdict has nothing pending to move.
    expect((await review(owner, { decision: "approved" })).status).toBe(409);
  });

  it("rejects with a reason and refuses a non-owner", async () => {
    const headers = await sessionHeaders();
    await verifyAuthor("acme");
    const { version } = await submit(headers, hardwarePlugin(), "plugin");
    await finalize(headers, version);

    expect(
      (await review(headers, { decision: "approved" })).status,
    ).toBe(404);

    const owner = await ownerHeaders();
    const rejected = await review(owner, {
      decision: "rejected",
      reason: "plugs into an unlisted device",
    });
    expect(rejected.status).toBe(200);
    const row = await env.DB.prepare(
      "SELECT status, status_reason, review_state FROM item WHERE id = ?",
    )
      .bind(ITEM_ID)
      .first<{
        status: string;
        status_reason: string | null;
        review_state: string;
      }>();
    expect(row).toMatchObject({
      status: "rejected",
      status_reason: "plugs into an unlisted device",
      review_state: "rejected",
    });
  });
});
