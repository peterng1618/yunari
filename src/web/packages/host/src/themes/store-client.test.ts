import type { FabricThemeEnvelope } from "@yunari/renderer-core";
import { describe, expect, it } from "vitest";
import { createStoreClient, StoreClientError } from "./store-client.js";

const ITEM_ID = "3f2a1c9e-8b7d-4c6a-9e0f-1a2b3c4d5e6f";
const ORIGIN = "https://store.test";
const UPLOAD_URL = "https://r2.test/packages/the-theme/1.0.1.zip";
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);
const PACKAGE_BYTES = new Uint8Array([7, 7, 7]);

const envelope: FabricThemeEnvelope = {
  schemaVersion: "2.0.0",
  fabricVersion: "7.4.0",
  id: ITEM_ID,
  artboard: { width: 1920, height: 1080 },
  metadata: { name: "Mine", themeLanguage: "en" },
  scene: { version: "7.4.0", objects: [] },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The Worker's four calls, in order, with every request recorded. */
function fakeFetch(seen: string[], authorization: (string | null)[] = []) {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    seen.push(url);
    authorization.push(new Headers(init?.headers).get("authorization"));

    if (url === `${ORIGIN}/api/me/items/${ITEM_ID}/baseline`) {
      return json({
        version: "1.0.0",
        createdAt: "2026-10-01T00:00:00.000Z",
        envelope,
        status: "published",
      });
    }
    if (url === `${ORIGIN}/api/me/items/${ITEM_ID}/versions`) {
      return json({
        version: "1.0.1",
        status: "pending",
        uploadUrl: UPLOAD_URL,
      });
    }
    if (url === UPLOAD_URL) return new Response(null, { status: 200 });
    if (url === `${ORIGIN}/api/me/items/${ITEM_ID}/versions/1.0.1/finalize`) {
      return json({ ok: true, status: "pending", version: "1.0.1" });
    }
    return new Response("Not found", { status: 404 });
  };
}

describe("createStoreClient", () => {
  it("reads the authenticated baseline and submits envelope, package and thumbnail", async () => {
    const seen: string[] = [];
    const authorization: (string | null)[] = [];
    const client = createStoreClient({
      origin: ORIGIN,
      token: "t",
      fetch: fakeFetch(seen, authorization) as typeof fetch,
    });

    expect(await client.baseline(ITEM_ID)).toMatchObject({ version: "1.0.0" });
    const plan = await client.createVersion(ITEM_ID, {
      envelope,
      name: "Mine",
    });
    await client.upload(plan.uploadUrl, PACKAGE_BYTES);
    expect(await client.finalize(ITEM_ID, "1.0.1", PNG)).toMatchObject({
      status: "pending",
    });
    expect(seen).toContain(`${ORIGIN}/api/me/items/${ITEM_ID}/baseline`);

    // The token travels on every authenticated call and on no other: the
    // presigned PUT is the only one that must not carry it.
    expect(authorization).toEqual(["Bearer t", "Bearer t", null, "Bearer t"]);
  });

  it("toggles the favourite under the item, never under /api/me/favorites", async () => {
    const calls: { url: string; method: string | undefined }[] = [];
    const client = createStoreClient({
      origin: ORIGIN,
      token: "t",
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(input), method: init?.method });
        return json({ ok: true, favorites: 1 });
      }) as typeof fetch,
    });

    await client.favorite(ITEM_ID, true);
    await client.favorite(ITEM_ID, false);

    expect(calls).toEqual([
      { url: `${ORIGIN}/api/me/items/${ITEM_ID}/favorite`, method: "PUT" },
      { url: `${ORIGIN}/api/me/items/${ITEM_ID}/favorite`, method: "DELETE" },
    ]);
  });

  it("reads the author's own listing with the token", async () => {
    const calls: { url: string; method: string | undefined }[] = [];
    const authorization: (string | null)[] = [];
    const entries = [{ id: ITEM_ID, status: "unpublished" }];
    const client = createStoreClient({
      origin: ORIGIN,
      token: "t",
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(input), method: init?.method });
        authorization.push(new Headers(init?.headers).get("authorization"));
        return json({ entries });
      }) as typeof fetch,
    });

    expect(await client.mine()).toEqual({ entries });

    expect(calls).toEqual([{ url: `${ORIGIN}/api/me/items`, method: "GET" }]);
    expect(authorization).toEqual(["Bearer t"]);
  });

  it("answers undefined for a baseline the store does not hold", async () => {
    const client = createStoreClient({
      origin: ORIGIN,
      token: "t",
      fetch: (async () =>
        new Response("Not found", { status: 404 })) as typeof fetch,
    });

    expect(await client.baseline(ITEM_ID)).toBeUndefined();
  });

  it("throws the Worker's own sentence for a refusal", async () => {
    const client = createStoreClient({
      origin: ORIGIN,
      token: "t",
      fetch: (async () =>
        new Response("This theme has not changed.", {
          status: 400,
        })) as typeof fetch,
    });

    await expect(
      client.createVersion(ITEM_ID, { envelope, name: "Mine" }),
    ).rejects.toThrow("This theme has not changed.");
    await expect(
      client.createVersion(ITEM_ID, { envelope, name: "Mine" }),
    ).rejects.toBeInstanceOf(StoreClientError);
  });
});
