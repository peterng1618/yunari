import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  downloads,
  fixturePackageKey,
  ITEM_ID,
  indexIds,
  PACKAGE_BYTES,
  putPackage,
  seedPublished,
} from "./seed";

const BASE = "https://store.test";

describe("public reads", () => {
  it("serves the index, then 404s every unpublished read", async () => {
    await seedPublished({ versions: ["1.0.0", "1.0.1"] });
    const index = await SELF.fetch("https://store.test/index.json");
    expect(index.headers.get("cache-control")).toContain("max-age=60");
    expect(await index.json()).toMatchObject({ entries: [{ id: ITEM_ID }] });
    const item = await (
      await SELF.fetch(`https://store.test/catalogue/${ITEM_ID}/item.json`)
    ).json();
    expect(item).toMatchObject({ id: ITEM_ID, downloads: 0, favorites: 0 });
    expect(
      (
        await SELF.fetch(
          `https://store.test/catalogue/${ITEM_ID}/thumbnail.png`,
        )
      ).headers.get("cache-control"),
    ).toContain("max-age=300");
    const first = await SELF.fetch(
      `https://store.test/catalogue/${ITEM_ID}/1.0.0.zip`,
    );
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect((await first.arrayBuffer()).byteLength).toBe(
      PACKAGE_BYTES.byteLength,
    );
    await env.DB.prepare("UPDATE item SET status = 'unpublished' WHERE id = ?")
      .bind(ITEM_ID)
      .run();
    for (const path of [
      `item.json`,
      `thumbnail.png`,
      `1.0.0.zip`,
      `1.0.1.zip`,
    ]) {
      expect(
        (await SELF.fetch(`https://store.test/catalogue/${ITEM_ID}/${path}`))
          .status,
      ).toBe(404);
    }
    expect(await downloads(env.DB, ITEM_ID)).toBe(1);
  });

  it("counts every package response, twice", async () => {
    await seedPublished({ versions: ["1.0.0"] });
    await SELF.fetch(`${BASE}/catalogue/${ITEM_ID}/1.0.0.zip`);
    const second = await SELF.fetch(`${BASE}/catalogue/${ITEM_ID}/1.0.0.zip`);
    expect(second.status).toBe(200);
    expect(await second.text()).toBe(new TextDecoder().decode(PACKAGE_BYTES));
    expect(await downloads(env.DB, ITEM_ID)).toBe(2);
    await env.DB.prepare("UPDATE item SET status = 'unpublished' WHERE id = ?")
      .bind(ITEM_ID)
      .run();
    const after = await SELF.fetch(`${BASE}/catalogue/${ITEM_ID}/1.0.0.zip`);
    expect(after.status).toBe(404);
    expect(await downloads(env.DB, ITEM_ID)).toBe(2);
  });

  it("lists the latest version by finalize instant, not by version text", async () => {
    await seedPublished({ versions: ["1.0.9", "1.0.10"] });
    const index = (await (await SELF.fetch(`${BASE}/index.json`)).json()) as {
      entries: { id: string; version: string }[];
    };
    expect(index.entries[0]?.version).toBe("1.0.10");
    const item = (await (
      await SELF.fetch(`${BASE}/catalogue/${ITEM_ID}/item.json`)
    ).json()) as { version: string };
    expect(item.version).toBe("1.0.10");
    expect(await indexIds()).toEqual([ITEM_ID]);
  });

  it("answers the item's own cache window and CORS on every public answer", async () => {
    await seedPublished({ favorites: 2 });
    const item = await SELF.fetch(`${BASE}/catalogue/${ITEM_ID}/item.json`);
    expect(((await item.json()) as { favorites: number }).favorites).toBe(2);
    expect(item.headers.get("cache-control")).toContain("max-age=60");
    expect(item.headers.get("access-control-allow-origin")).toBe("*");
    const index = await SELF.fetch(`${BASE}/index.json`);
    expect(index.headers.get("access-control-allow-origin")).toBe("*");
    const entries = (
      (await index.json()) as {
        entries: { favorites: number }[];
      }
    ).entries;
    expect(entries[0]?.favorites).toBe(2);
    const missing = await SELF.fetch(`${BASE}/catalogue/${ITEM_ID}/9.9.9.zip`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("does not count a download when the object is missing", async () => {
    await seedPublished({ versions: ["1.0.0"] });
    await env.BUCKET.delete(fixturePackageKey(ITEM_ID, "1.0.0"));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(
        (await SELF.fetch(`${BASE}/catalogue/${ITEM_ID}/1.0.0.zip`)).status,
      ).toBe(404);
    }
    expect(await downloads(env.DB, ITEM_ID)).toBe(0);
  });

  it("answers 304 for a matching index ETag and 404 for unknown ids", async () => {
    await seedPublished();
    const first = await SELF.fetch(`${BASE}/index.json`);
    const etag = first.headers.get("etag");
    expect(etag).not.toBeNull();
    const revalidated = await SELF.fetch(`${BASE}/index.json`, {
      headers: { "if-none-match": etag ?? "" },
    });
    expect(revalidated.status).toBe(304);
    const unknown = "11111111-2222-3333-4444-555555555555";
    expect(
      (await SELF.fetch(`${BASE}/catalogue/${unknown}/item.json`)).status,
    ).toBe(404);
    expect(
      (await SELF.fetch(`${BASE}/catalogue/${unknown}/thumbnail.png`)).status,
    ).toBe(404);
    await putPackage(fixturePackageKey(unknown, "1.0.0"), PACKAGE_BYTES);
    expect(
      (await SELF.fetch(`${BASE}/catalogue/${unknown}/1.0.0.zip`)).status,
    ).toBe(404);
  });
});
