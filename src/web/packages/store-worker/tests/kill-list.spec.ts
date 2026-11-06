import { env, SELF } from "cloudflare:test";
import type { TestHelpers } from "better-auth/plugins";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAuth } from "../src/auth";
import { BASE, sessionHeaders } from "./helpers";

const OWNER_ID = "user-kill-owner";
const OWNER_EMAIL = "owner@example.com";
const KEY = "acme/acme-sensors";

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

function kill(
  headers: Record<string, string>,
  key: string,
  method: "PUT" | "DELETE",
  body: unknown = {},
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/admin/kill-list/${key}`, {
    method,
    headers: { ...headers, "content-type": "application/json" },
    ...(method === "PUT" ? { body: JSON.stringify(body) } : {}),
  });
}

async function readList(): Promise<{
  readonly version: number;
  readonly generatedAt: string;
  readonly plugins: Record<string, { readonly advisory?: string }>;
}> {
  const response = await SELF.fetch(`${BASE}/kill-list.json`);
  expect(response.headers.get("cache-control")).toBe("max-age=60");
  return (await response.json()) as {
    readonly version: number;
    readonly generatedAt: string;
    readonly plugins: Record<string, { readonly advisory?: string }>;
  };
}

describe("kill list", () => {
  beforeAll(async () => {
    const migrated = await SELF.fetch(`${BASE}/migrate`, {
      method: "POST",
      headers: { "x-migrate-token": "test-migrate" },
    });
    expect(migrated.status).toBe(200);
  });

  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM kill_list").run();
  });

  it("serves the owner's revocations and forgets a cleared one", async () => {
    const owner = await ownerHeaders();
    expect((await readList()).plugins).toEqual({});

    expect(
      (await kill(owner, KEY, "PUT", { advisoryUrl: "https://example.test/a" }))
        .status,
    ).toBe(200);
    expect((await readList()).plugins).toEqual({
      [KEY]: { advisory: "https://example.test/a" },
    });

    // Listing it again moves the link, not the key.
    expect((await kill(owner, KEY, "PUT", {})).status).toBe(200);
    expect((await readList()).plugins).toEqual({ [KEY]: {} });

    expect((await kill(owner, KEY, "DELETE")).status).toBe(200);
    expect((await readList()).plugins).toEqual({});
    expect((await kill(owner, KEY, "DELETE")).status).toBe(404);
  });

  it("refuses a non-https advisory, a bare key and a non-owner", async () => {
    const owner = await ownerHeaders();
    expect(
      (
        await kill(owner, KEY, "PUT", {
          advisoryUrl: "http://example.test/a",
        })
      ).status,
    ).toBe(400);
    expect((await kill(owner, "acme-sensors", "PUT")).status).toBe(404);

    const author = await sessionHeaders();
    expect((await kill(author, KEY, "PUT")).status).toBe(404);
  });
});
