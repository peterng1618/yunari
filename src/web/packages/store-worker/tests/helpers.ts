import { env, SELF } from "cloudflare:test";
import type { TestHelpers } from "better-auth/plugins";
import { createAuth } from "../src/auth";
import { ITEM_ID } from "./seed";

export const BASE = "https://store.test";

/** The account every author request in a spec acts as. */
export const USER_ID = "user-versions-author";
const USER_EMAIL = "author@example.com";

/**
 * A signed-in author's request headers.
 *
 * The user is created once per pool state; a second call reuses it, because a
 * file's D1 rows survive between its tests.
 */
export async function sessionHeaders(): Promise<Record<string, string>> {
  const existing = await env.DB.prepare("SELECT id FROM user WHERE id = ?")
    .bind(USER_ID)
    .first();
  if (existing === null) {
    const test = await testHelpers();
    await test.saveUser(test.createUser({ id: USER_ID, email: USER_EMAIL }));
  }
  const { headers } = await (await testHelpers()).login({ userId: USER_ID });
  return Object.fromEntries(headers.entries());
}

async function testHelpers(): Promise<TestHelpers> {
  const context = await createAuth(env).$context;
  return (context as unknown as { test: TestHelpers }).test;
}

/**
 * A minimal valid envelope, claiming the version the ladder computes for a
 * first submission. `id` is the catalogue item the request will name, so the
 * helper's caller decides whether path and envelope agree.
 */
export function candidate(
  id: string = ITEM_ID,
  version = "1.0.0",
): Record<string, unknown> {
  return {
    schemaVersion: "2.0.0",
    fabricVersion: "7.4.0",
    id,
    metadata: { themeLanguage: "en", version },
    artboard: { width: 400, height: 300 },
    scene: {
      version: "7.4.0",
      objects: [{ type: "Rect", id: "background" }],
    },
  };
}

export interface VersionRequestOptions {
  readonly name?: string;
  readonly envelope?: unknown;
}

/** POSTs a version request as the session's author, naming `id` in the path. */
export async function createVersion(
  headers: Record<string, string>,
  id: string,
  options: VersionRequestOptions = {},
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/me/items/${id}/versions`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      envelope: options.envelope ?? candidate(id),
      name: options.name ?? "Mine",
    }),
  });
}
