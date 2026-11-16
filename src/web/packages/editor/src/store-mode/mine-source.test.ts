import { DASHBOARD_THEME_KIND } from "@yunari/renderer-core";
import { describe, expect, it, vi } from "vitest";
import { mineThemeSource } from "./mine-source.js";

/**
 * The author's own listing, as the host proxies it: `{ entries }` where each row
 * is a catalogue entry plus the state the public wire shape has no room for.
 *
 * **The fixture is written here, not imported from the Worker.** The wire shape
 * is public (`renderer-core`'s `catalogue-index.ts`), and a client tested only
 * against the Worker's own output would agree with the Worker rather than with
 * the shape.
 */

const ITEM_ID = "5d41402a-bc4b-4c8a-9d0e-2f1a3b4c5d6e";

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
  id: ITEM_ID,
  kind: DASHBOARD_THEME_KIND,
  name: "Office wall",
  version: "1.3.0",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-14T00:00:00.000Z",
  downloads: 42,
  favorites: 7,
  packageUrl: `https://store.test/catalogue/${ITEM_ID}/1.3.0.zip`,
  thumbnail: `catalogue/${ITEM_ID}/thumbnail.png`,
  members: [
    { id: "living-room", kind: DASHBOARD_THEME_KIND, name: "Office wall" },
  ],
  facets: FACETS,
  status: "published",
};

/** A `fetch` answering one document, which is the only thing this source asks
 *  it for. */
function answering(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

/** The answer the host's own route gives: `{ entries }`, no `generatedAt`. */
function mineWith(entries: readonly unknown[]): typeof fetch {
  return answering({ entries });
}

describe("the author's own source", () => {
  it("maps status and reason from the host answer", async () => {
    const source = mineThemeSource({
      fetch: mineWith([
        {
          ...ENTRY,
          status: "unpublished",
          statusReason: "Withdrawn by the author",
        },
      ]),
    });

    const [item] = await source.list();

    expect(item).toMatchObject({
      id: ITEM_ID,
      status: "unpublished",
      statusReason: "Withdrawn by the author",
    });
  });

  it("asks the host's own listing route", async () => {
    const fetcher = mineWith([ENTRY]);
    await mineThemeSource({ fetch: fetcher }).list();

    expect(fetcher).toHaveBeenCalledWith("/api/store/mine");
  });

  it("reads the row as the item the gallery draws", async () => {
    const source = mineThemeSource({ fetch: mineWith([ENTRY]) });

    const [item] = await source.list();

    if (item === undefined) throw new Error("the source listed nothing");
    expect(item.kind).toBe(DASHBOARD_THEME_KIND);
    expect(item.name).toBe(ENTRY.name);
    expect(item.author).toBe(FACETS.author);
    expect(item.version).toBe(ENTRY.version);
    expect(item.updatedAt).toBe(ENTRY.updatedAt);
    expect(item.thumbnailUrl).toContain("thumbnail.png");
    expect(item.facets).toEqual(FACETS);
    expect(item.catalogue).toEqual({
      id: ENTRY.id,
      createdAt: ENTRY.createdAt,
      updatedAt: ENTRY.updatedAt,
      downloads: ENTRY.downloads,
      favorites: ENTRY.favorites,
      packageUrl: ENTRY.packageUrl,
      installedVersion: undefined,
    });
    expect(source.refused()).toEqual([]);
  });

  it("leaves the reason absent when the host sends none", async () => {
    const source = mineThemeSource({ fetch: mineWith([ENTRY]) });

    const [item] = await source.list();

    if (item === undefined) throw new Error("the source listed nothing");
    // `exactOptionalPropertyTypes`: a row with no sentence has no key, rather
    // than a key holding `undefined`.
    expect("statusReason" in item).toBe(false);
  });

  it("drops a row whose status this build cannot read", async () => {
    const source = mineThemeSource({
      fetch: mineWith([
        ENTRY,
        {
          ...ENTRY,
          id: "8f14e45f-ceea-4670-9c1e-0f4b4b9d0a11",
          status: "shadow-banned",
        },
      ]),
    });

    const items = await source.list();

    expect(items.map((item) => item.id)).toEqual([ITEM_ID]);
  });

  it("counts a row it dropped for an unreadable state as refused", async () => {
    // A dropped row is still a row the host sent: an empty listing plus no
    // refusal would draw "you have no submissions yet" over one that exists.
    const source = mineThemeSource({
      fetch: mineWith([{ ...ENTRY, status: "shadow-banned" }]),
    });

    const items = await source.list();

    expect(items).toEqual([]);
    expect(source.refused()).toEqual([
      { kind: DASHBOARD_THEME_KIND, reason: "malformed", count: 1 },
    ]);
  });

  it("rejects when the host answers not-ok", async () => {
    const source = mineThemeSource({ fetch: answering("", 401) });

    await expect(source.list()).rejects.toThrow("401");
  });

  it("rejects a body that is not JSON", async () => {
    const source = mineThemeSource({
      fetch: vi.fn(
        async () => new Response("not json", { status: 200 }),
      ) as unknown as typeof fetch,
    });

    await expect(source.list()).rejects.toThrow();
  });

  it("reports the entries the listing skipped", async () => {
    const source = mineThemeSource({
      fetch: mineWith([ENTRY, { ...ENTRY, name: "" }]),
    });

    const items = await source.list();

    expect(items.map((item) => item.id)).toEqual([ITEM_ID]);
    expect(source.refused()).toEqual([
      { kind: DASHBOARD_THEME_KIND, reason: "malformed", count: 1 },
    ]);
  });

  /** **The author's listing is every kind they own**, not only themes: a
   *  submitted collection appears beside the themes it names. */
  it("lists a submitted collection beside the other kinds", async () => {
    const collectionId = "3f2a1c9e-8b7d-4c6a-9e0f-1a2b3c4d5e6f";
    const source = mineThemeSource({
      fetch: mineWith([
        ENTRY,
        {
          ...ENTRY,
          id: collectionId,
          kind: "collection",
          name: "Acme Kit",
          members: [],
          includes: [ITEM_ID],
        },
      ]),
    });

    const items = await source.list();

    expect(items.map((item) => [item.id, item.kind])).toEqual([
      [ITEM_ID, DASHBOARD_THEME_KIND],
      [collectionId, "collection"],
    ]);
    expect(items[1]?.includes).toEqual([ITEM_ID]);
  });
});
