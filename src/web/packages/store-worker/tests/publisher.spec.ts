import { SELF } from "cloudflare:test";
import { beforeEach, beforeAll, describe, expect, it } from "vitest";
import { publisherFor } from "../src/catalogue/publisher";
import { BASE, sessionHeaders } from "./helpers";
import { ITEM_ID } from "./seed";
import {
  finalize,
  itemRow,
  pluginPackage,
  reset,
  sha256Hex,
  submit,
  verifyAuthor,
} from "./packs-submit";

describe("publisherFor", () => {
  it("slugs the display name, then the email local part, then the user id", () => {
    expect(
      publisherFor({
        userId: "user-1",
        displayName: "Acme Corp",
        email: "nope@example.com",
      }),
    ).toEqual({ ok: true, publisher: "acme-corp" });
    expect(
      publisherFor({
        userId: "user-1",
        displayName: null,
        email: "ada@example.com",
      }),
    ).toEqual({ ok: true, publisher: "ada" });
    expect(
      publisherFor({ userId: "user-1", displayName: "", email: "" }),
    ).toEqual({ ok: true, publisher: "user-1" });
  });

  it("refuses a reserved publisher whatever field it came from", () => {
    for (const name of ["yunari", "Yunari Labs", "official"]) {
      expect(
        publisherFor({ userId: "user-1", displayName: name, email: "" }),
      ).toMatchObject({ ok: false });
    }
  });
});

describe("the store's publisher", () => {
  beforeAll(async () => {
    const migrated = await SELF.fetch(`${BASE}/migrate`, {
      method: "POST",
      headers: { "x-migrate-token": "test-migrate" },
    });
    expect(migrated.status).toBe(200);
  });

  beforeEach(reset);

  it("ignores a manifest publisher and uses the account's slug", async () => {
    const headers = await sessionHeaders();
    await verifyAuthor("Acme Corp");
    const { version } = await submit(
      headers,
      pluginPackage({ publisher: "other" }),
      "plugin",
    );
    expect((await finalize(headers, version)).status).toBe(200);
    expect((await itemRow()).publisher).toBe("acme-corp");
  });

  it("refuses a submission from an account whose slug is reserved", async () => {
    const headers = await sessionHeaders();
    await verifyAuthor("Yunari");
    const bytes = pluginPackage();

    const response = await SELF.fetch(
      `${BASE}/api/me/items/${ITEM_ID}/versions`,
      {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          kind: "plugin",
          name: "Plugin One",
          version: "1.0.0",
          metadata: {},
          sha256: await sha256Hex(bytes),
          bytes: bytes.byteLength,
        }),
      },
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("reserved");
  });
});
