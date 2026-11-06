import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * The extension-kind migration: the columns the store writes a non-theme
 * version through, the review vocabulary both tables enforce, and the kill
 * list. D1 stores the CHECK constraints, so the refusal is proved here rather
 * than trusted from the SQL text.
 */
async function columns(table: string): Promise<readonly string[]> {
  const rows = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{
    readonly name: string;
  }>();
  return rows.results.map((row) => row.name);
}

describe("extension kinds migration", () => {
  it("adds the item, version and presign columns", async () => {
    expect(await columns("item")).toEqual(
      expect.arrayContaining(["publisher", "review_state"]),
    );
    expect(await columns("item_version")).toEqual(
      expect.arrayContaining([
        "metadata_json",
        "execution_profile",
        "review_state",
      ]),
    );
    expect(await columns("presign_event")).toEqual(
      expect.arrayContaining([
        "kind",
        "metadata_json",
        "declared_sha256",
        "declared_bytes",
        "execution_profile",
      ]),
    );
  });

  it("refuses a review state outside the four states", async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO item (id, kind, author_user_id, name, status, created_at,
           updated_at, review_state)
         VALUES ('migration-check', 'widget-pack', 'user', 'Mine', 'draft', ?, ?, 'bogus')`,
      )
        .bind("2026-11-06T00:00:00.000Z", "2026-11-06T00:00:00.000Z")
        .run(),
    ).rejects.toThrow(/CHECK/i);
    await env.DB.prepare("DELETE FROM item WHERE id = 'migration-check'").run();
  });

  it("creates the kill list, keyed by the qualified plugin key", async () => {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO kill_list (plugin_key, advisory_url, created_at)
       VALUES ('acme/sensors', 'https://example.test/advisory', ?)`,
    )
      .bind("2026-11-06T00:00:00.000Z")
      .run();
    const row = await env.DB.prepare(
      "SELECT advisory_url FROM kill_list WHERE plugin_key = ?",
    )
      .bind("acme/sensors")
      .first<{ advisory_url: string }>();
    expect(row?.advisory_url).toBe("https://example.test/advisory");
    await env.DB.prepare("DELETE FROM kill_list WHERE plugin_key = ?")
      .bind("acme/sensors")
      .run();
  });
});
