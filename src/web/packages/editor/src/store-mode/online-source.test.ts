import {
  catalogueIndexUrl,
  cataloguePackageUrl,
  catalogueThumbnailUrl,
  DASHBOARD_THEME_KIND,
} from "@yunari/renderer-core";
import { describe, expect, it, vi } from "vitest";
import { onlineThemeSource } from "./online-source.js";

/**
 * The catalogue's own listing, as one static document.
 *
 * **The fixture is written here, not imported from the producer.** The wire
 * shape is public (`renderer-core`'s `catalogue-index.ts`), and a client tested
 * only against the generator's own output would agree with the generator rather
 * than with the shape.
 */

const FACETS = {
  author: "mira-k",
  colourMode: "dark",
  sensors: [{ key: "cpu.load", label: "CPU load", family: "cpu" }],
  tags: ["retro"],
  orientation: "landscape",
  aspect: "16:9",
  width: 1920,
  height: 1080,
};

const ENTRY = {
  id: "yunari/office-wall",
  kind: DASHBOARD_THEME_KIND,
  name: "Office wall",
  version: "1.3.0",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-14T00:00:00.000Z",
  downloads: 42,
  favorites: 7,
  packageUrl: cataloguePackageUrl("yunari/office-wall", "1.3.0"),
  thumbnail: "catalogue/yunari/office-wall/thumbnail.png",
  facets: FACETS,
};

function indexWith(entries: readonly unknown[]): string {
  return JSON.stringify({
    generatedAt: "2026-10-21T00:00:00.000Z",
    entries,
  });
}

/** A `fetch` answering one document, which is the only thing this source asks
 *  it for. */
function answering(body: string, status = 200): typeof fetch {
  return vi.fn(async () => new Response(body, { status }));
}

describe("the catalogue's source", () => {
  it("maps an index entry to the item the gallery draws", async () => {
    const fetcher = answering(indexWith([ENTRY]));
    const source = onlineThemeSource({ fetch: fetcher });

    const items = await source.list();

    // One plain read of the address, with no `cache:` option: the browser's own
    // HTTP cache is the whole freshness mechanism.
    expect(fetcher).toHaveBeenCalledWith(catalogueIndexUrl());
    const [item] = items;
    if (item === undefined) throw new Error("the source listed nothing");
    expect(item.id).toBe(ENTRY.id);
    expect(item.kind).toBe(DASHBOARD_THEME_KIND);
    expect(item.name).toBe(ENTRY.name);
    expect(item.author).toBe(FACETS.author);
    expect(item.version).toBe(ENTRY.version);
    expect(item.updatedAt).toBe(ENTRY.updatedAt);
    expect(item.thumbnailUrl).toBe(
      catalogueThumbnailUrl("catalogue/yunari/office-wall/thumbnail.png"),
    );
    expect(item.origin).toBeUndefined();
    expect(item.facets).toEqual(FACETS);
    expect(item.catalogue).toEqual({
      id: ENTRY.id,
      createdAt: ENTRY.createdAt,
      updatedAt: ENTRY.updatedAt,
      downloads: ENTRY.downloads,
      favorites: ENTRY.favorites,
      packageUrl: ENTRY.packageUrl,
      // A source reads the catalogue; what this PC has installed is the
      // library's fact, so the join fills it rather than the source guessing.
      installedVersion: undefined,
    });
    expect(source.refused()).toEqual([]);
  });

  it("reads the address it is given instead of the default", async () => {
    const fetcher = answering(indexWith([ENTRY]));
    await onlineThemeSource({
      url: "https://mirror.test/index.json",
      fetch: fetcher,
    }).list();

    expect(fetcher).toHaveBeenCalledWith("https://mirror.test/index.json");
  });

  it("rejects when the catalogue answers not-ok", async () => {
    const source = onlineThemeSource({ fetch: answering("", 500) });

    await expect(source.list()).rejects.toThrow("500");
  });

  it("rejects a 404 rather than answering an empty listing", async () => {
    // A raw 404 is never negatively cached, so a client that read one as "no
    // themes" would retry the mistyped path forever and draw an empty catalogue
    // as though the catalogue were empty.
    const source = onlineThemeSource({ fetch: answering("", 404) });

    await expect(source.list()).rejects.toThrow("404");
  });

  it("rejects a body that is not JSON", async () => {
    const source = onlineThemeSource({ fetch: answering("not json") });

    await expect(source.list()).rejects.toThrow();
  });

  it("reports the entries the listing skipped", async () => {
    const source = onlineThemeSource({
      fetch: answering(
        indexWith([
          ENTRY,
          { ...ENTRY, id: "yunari/widget", kind: "widget-theme" },
        ]),
      ),
    });

    const items = await source.list();

    expect(items.map((item) => item.id)).toEqual([ENTRY.id]);
    expect(source.refused()).toEqual([
      { kind: "widget-theme", reason: "unknown-kind", count: 1 },
    ]);
  });

  it("forgets the refusals of a read that failed", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          indexWith([
            ENTRY,
            { ...ENTRY, id: "yunari/widget", kind: "widget-theme" },
          ]),
        ),
      )
      .mockResolvedValueOnce(
        new Response("", { status: 500 }),
      ) as unknown as typeof fetch;
    const source = onlineThemeSource({ fetch: fetcher });

    await source.list();
    expect(source.refused()).toHaveLength(1);

    await expect(source.list()).rejects.toThrow("500");
    expect(source.refused()).toEqual([]);
  });

  it("forgets the refusals of a read that rejected", async () => {
    // The production failure shapes — offline, a DNS failure, an abort — reject
    // the promise rather than answer a status, so nothing after the `await`
    // runs and only a clear at method entry leaves `refused()` empty.
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          indexWith([
            ENTRY,
            { ...ENTRY, id: "yunari/widget", kind: "widget-theme" },
          ]),
        ),
      )
      .mockRejectedValueOnce(
        new TypeError("Failed to fetch"),
      ) as unknown as typeof fetch;
    const source = onlineThemeSource({ fetch: fetcher });

    await source.list();
    expect(source.refused()).toHaveLength(1);

    await expect(source.list()).rejects.toThrow("Failed to fetch");
    expect(source.refused()).toEqual([]);
  });
});
