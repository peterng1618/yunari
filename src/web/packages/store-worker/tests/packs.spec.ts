import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BASE, sessionHeaders } from "./helpers";
import {
  finalize,
  itemRow,
  pluginPackage,
  reset,
  sha256Hex,
  submit,
  verifyAuthor,
  widgetPack,
} from "./packs-submit";
import { ITEM_ID, statusOf, versionsOf } from "./seed";

describe("pack submissions", () => {
  beforeAll(async () => {
    // Better Auth owns `user` and `session`; only `/migrate` creates them.
    const migrated = await SELF.fetch(`${BASE}/migrate`, {
      method: "POST",
      headers: { "x-migrate-token": "test-migrate" },
    });
    expect(migrated.status).toBe(200);
  });

  beforeEach(reset);

  it("refuses a widget pack whose uploaded digest differs", async () => {
    const headers = await sessionHeaders();
    await verifyAuthor("acme");
    const bytes = widgetPack();
    const { version } = await submit(headers, bytes, "widget-pack", {
      declaredSha256: "0".repeat(64),
      declaredBytes: bytes.byteLength,
    });

    const response = await finalize(headers, version);
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("does not match");
    expect(await versionsOf(env.DB, ITEM_ID)).toEqual([]);
  });

  it("publishes a declarative plugin under the account publisher", async () => {
    const headers = await sessionHeaders();
    await verifyAuthor("acme");
    const bytes = pluginPackage({ publisher: "yunari" });
    const { version } = await submit(headers, bytes, "plugin");

    const response = await finalize(headers, version);
    expect(response.status, await response.clone().text()).toBe(200);
    const row = await itemRow();
    expect(row.kind).toBe("plugin");
    expect(row.publisher).toBe("acme");
    expect(row.status).toBe("published");
    expect(await statusOf(env.DB, ITEM_ID)).toBe("published");
    expect(await versionsOf(env.DB, ITEM_ID)).toEqual([version]);
  });

  it("holds a first submission with no verified author", async () => {
    const headers = await sessionHeaders();
    const bytes = widgetPack();
    const { version } = await submit(headers, bytes, "widget-pack");

    const response = await finalize(headers, version);
    expect(response.status).toBe(200);
    expect(await statusOf(env.DB, ITEM_ID)).toBe("pending");
  });

  it("refuses a version that is not greater than the published one", async () => {
    const headers = await sessionHeaders();
    await verifyAuthor("acme");
    const bytes = widgetPack();
    const first = await submit(headers, bytes, "widget-pack");
    expect(first.version).toBe("1.0.0");
    expect((await finalize(headers, first.version)).status).toBe(200);

    const response = await SELF.fetch(
      `${BASE}/api/me/items/${ITEM_ID}/versions`,
      {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          kind: "widget-pack",
          name: "Pack One",
          version: "1.0.0",
          metadata: {},
          sha256: await sha256Hex(bytes),
          bytes: bytes.byteLength,
        }),
      },
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("must be greater");
  });

  it("refuses an upload whose package its kind cannot read", async () => {
    const headers = await sessionHeaders();
    await verifyAuthor("acme");
    const notAPack = new TextEncoder().encode("not a widget package");
    const { version } = await submit(headers, notAPack, "widget-pack");

    const response = await finalize(headers, version);
    expect(response.status).toBe(400);
    expect(await versionsOf(env.DB, ITEM_ID)).toEqual([]);
  });

  it("stores the package's own metadata and execution profile", async () => {
    const headers = await sessionHeaders();
    await verifyAuthor("acme");
    const bytes = pluginPackage();
    const { version } = await submit(headers, bytes, "plugin");
    expect((await finalize(headers, version)).status).toBe(200);

    const row = await env.DB.prepare(
      `SELECT metadata_json, execution_profile, envelope_json
       FROM item_version WHERE item_id = ? AND version = ?`,
    )
      .bind(ITEM_ID, version)
      .first<{
        metadata_json: string;
        execution_profile: string | null;
        envelope_json: string;
      }>();
    expect(row?.execution_profile).toBe("declarative");
    expect(row?.envelope_json).toBe("{}");
    const metadata = JSON.parse(row?.metadata_json ?? "{}") as {
      name?: string;
      manifest?: { id?: string };
    };
    expect(metadata.name).toBe("Plugin One");
    expect(metadata.manifest?.id).toBe("plugin-one");
  });
});
