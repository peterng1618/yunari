import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { StoreItemKind } from "@yunari/renderer-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type CatalogueOrigin,
  catalogueOriginOf,
  createCatalogueOriginsStore,
} from "./catalogue-origins.js";

const catalogueFile = (dir: string) => path.join(dir, "catalogue-origins.json");
const legacyFile = (dir: string) => path.join(dir, "theme-origins.json");

const origin = (kind: StoreItemKind, catalogueId: string): CatalogueOrigin => ({
  kind,
  catalogueId,
  version: "1.2.0",
  installedAt: "2026-10-21T09:00:00.000Z",
});

/** A row as `theme-origins.json` holds it: no kind, because the file is the
 *  dashboard theme's. */
const legacyOrigin = (catalogueId: string) => ({
  catalogueId,
  version: "1.2.0",
  installedAt: "2026-10-21T09:00:00.000Z",
});

describe("catalogue origins", () => {
  let dir: string;
  let store: ReturnType<typeof createCatalogueOriginsStore>;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "yunari-catalogue-origins-"));
    store = createCatalogueOriginsStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function seed(contents: string): Promise<void> {
    await writeFile(catalogueFile(dir), contents, "utf8");
  }

  it("reads an absent file as no origins", async () => {
    expect(await store.read()).toEqual({});
  });

  it("reads a legacy theme-origins row as a dashboard theme", async () => {
    await writeFile(
      legacyFile(dir),
      JSON.stringify({ "living-room": legacyOrigin("catalogue-living-room") }),
      "utf8",
    );

    expect(await store.read()).toEqual({
      "dashboard-theme:living-room": origin(
        "dashboard-theme",
        "catalogue-living-room",
      ),
    });
  });

  it("leaves the legacy file in place", async () => {
    const legacy = JSON.stringify({ wall: legacyOrigin("catalogue-wall") });
    await writeFile(legacyFile(dir), legacy, "utf8");

    await store.read();

    expect(await readFile(legacyFile(dir), "utf8")).toBe(legacy);
  });

  it("keeps two kinds with the same installed id apart", async () => {
    await store.write(
      "dashboard-theme",
      "shared",
      origin("dashboard-theme", "catalogue-theme"),
    );
    await store.write(
      "widget-pack",
      "shared",
      origin("widget-pack", "catalogue-pack"),
    );

    expect(await store.read()).toEqual({
      "dashboard-theme:shared": origin("dashboard-theme", "catalogue-theme"),
      "widget-pack:shared": origin("widget-pack", "catalogue-pack"),
    });
  });

  it("drops a malformed row without blanking the map", async () => {
    await seed(
      JSON.stringify({
        "dashboard-theme:wall": origin("dashboard-theme", "catalogue-wall"),
        "plugin:acme/sensors": origin("plugin", "catalogue-sensors"),
        "bad id": origin("widget-pack", "catalogue-bad"),
        unknown: origin("widget-pack", "catalogue-unknown"),
        "widget-pack:": origin("widget-pack", "catalogue-empty"),
        "widget-pack:mismatch": origin("plugin", "catalogue-mismatch"),
        "widget-pack:nokind": legacyOrigin("catalogue-nokind"),
        "widget-pack:badcollections": {
          ...origin("widget-pack", "catalogue-collections"),
          collections: [1],
        },
        "widget-pack:nulled": null,
      }),
    );

    // A hand-edited file must not blank the whole map, so one bad row is
    // dropped rather than throwing the rest away.
    expect(await store.read()).toEqual({
      "dashboard-theme:wall": origin("dashboard-theme", "catalogue-wall"),
      "plugin:acme/sensors": origin("plugin", "catalogue-sensors"),
    });
  });

  it("drops a malformed legacy row on its own", async () => {
    await writeFile(
      legacyFile(dir),
      JSON.stringify({
        wall: legacyOrigin("catalogue-wall"),
        "bad id": legacyOrigin("catalogue-bad"),
        missing: { catalogueId: "catalogue-missing", version: "1.0.0" },
        nulled: null,
      }),
      "utf8",
    );

    expect(await store.read()).toEqual({
      "dashboard-theme:wall": origin("dashboard-theme", "catalogue-wall"),
    });
  });

  it("lets a catalogue row win over the same legacy row", async () => {
    await writeFile(
      legacyFile(dir),
      JSON.stringify({ wall: legacyOrigin("catalogue-old") }),
      "utf8",
    );
    await store.write(
      "dashboard-theme",
      "wall",
      origin("dashboard-theme", "catalogue-new"),
    );

    expect(await store.read()).toEqual({
      "dashboard-theme:wall": origin("dashboard-theme", "catalogue-new"),
    });
  });

  it("keeps every legacy row across the first write", async () => {
    await writeFile(
      legacyFile(dir),
      JSON.stringify({
        wall: legacyOrigin("catalogue-wall"),
        office: legacyOrigin("catalogue-office"),
      }),
      "utf8",
    );

    // The first write snapshots the legacy rows into the register, so the
    // machine that just installed its first pack keeps its theme origins.
    await store.write(
      "widget-pack",
      "pack-one",
      origin("widget-pack", "catalogue-pack"),
    );

    expect(await store.read()).toEqual({
      "dashboard-theme:wall": origin("dashboard-theme", "catalogue-wall"),
      "dashboard-theme:office": origin("dashboard-theme", "catalogue-office"),
      "widget-pack:pack-one": origin("widget-pack", "catalogue-pack"),
    });
  });

  it("keeps a removal of a row the legacy file names", async () => {
    await writeFile(
      legacyFile(dir),
      JSON.stringify({ wall: legacyOrigin("catalogue-wall") }),
      "utf8",
    );
    await store.write(
      "widget-pack",
      "pack-one",
      origin("widget-pack", "catalogue-pack"),
    );

    await store.remove("dashboard-theme", "wall");

    // A row read from a file this register does not own must not come back on
    // the next read, or a removed theme would still name a copy in the
    // catalogue's bookkeeping.
    expect(await store.read()).toEqual({
      "widget-pack:pack-one": origin("widget-pack", "catalogue-pack"),
    });
  });

  it("writes and removes one kind's row", async () => {
    await store.write(
      "dashboard-theme",
      "wall",
      origin("dashboard-theme", "catalogue-wall"),
    );
    await store.write(
      "widget-pack",
      "pack-one",
      origin("widget-pack", "catalogue-pack"),
    );

    await store.remove("dashboard-theme", "wall");

    expect(await store.read()).toEqual({
      "widget-pack:pack-one": origin("widget-pack", "catalogue-pack"),
    });
    expect(JSON.parse(await readFile(catalogueFile(dir), "utf8"))).toEqual({
      "widget-pack:pack-one": origin("widget-pack", "catalogue-pack"),
    });
  });

  it("writes nothing when asked to remove a row it has no entry for", async () => {
    const stored = JSON.stringify({
      "dashboard-theme:wall": origin("dashboard-theme", "catalogue-wall"),
    });
    await seed(stored);

    await store.remove("dashboard-theme", "office");

    expect(await readFile(catalogueFile(dir), "utf8")).toBe(stored);
  });

  it("treats a malformed catalogue file as no origins, and does not write over it", async () => {
    const corrupt = "{ not json";
    await seed(corrupt);

    expect(await store.read()).toEqual({});

    // Nothing to remove is no write, so the unreadable file survives.
    await store.remove("dashboard-theme", "wall");

    expect(await readFile(catalogueFile(dir), "utf8")).toBe(corrupt);
  });

  it("refuses an installed id that is not one key segment, on write", async () => {
    await expect(
      store.write(
        "dashboard-theme",
        "../escape",
        origin("dashboard-theme", "catalogue-x"),
      ),
    ).rejects.toThrow("Invalid");

    await expect(readFile(catalogueFile(dir), "utf8")).rejects.toThrow();
  });

  it("keeps a legacy __proto__ key as an entry rather than as the map's prototype", async () => {
    const legacy = JSON.stringify(
      Object.fromEntries([["__proto__", legacyOrigin("catalogue-proto")]]),
    );
    await writeFile(legacyFile(dir), legacy, "utf8");

    const read = await store.read();

    expect(Object.hasOwn(read, "dashboard-theme:__proto__")).toBe(true);
    expect(Object.getPrototypeOf(read)).toBe(Object.prototype);
  });

  it("serializes overlapping writes so neither entry is lost", async () => {
    const pairs = Array.from({ length: 5 }, (_unused, index) => index);
    await Promise.all(
      pairs.flatMap((index) => [
        store.write(
          "dashboard-theme",
          `left-${index}`,
          origin("dashboard-theme", `catalogue-left-${index}`),
        ),
        store.write(
          "widget-pack",
          `right-${index}`,
          origin("widget-pack", `catalogue-right-${index}`),
        ),
      ]),
    );

    const expected = Object.fromEntries(
      pairs.flatMap((index) => [
        [
          `dashboard-theme:left-${index}`,
          origin("dashboard-theme", `catalogue-left-${index}`),
        ],
        [
          `widget-pack:right-${index}`,
          origin("widget-pack", `catalogue-right-${index}`),
        ],
      ]),
    );
    expect(await store.read()).toEqual(expected);
  });

  it("answers a read issued during a write with the completed write", async () => {
    await store.write(
      "dashboard-theme",
      "wall",
      origin("dashboard-theme", "catalogue-wall"),
    );

    const writing = store.write(
      "widget-pack",
      "office",
      origin("widget-pack", "catalogue-office"),
    );
    const reading = store.read();
    const [, read] = await Promise.all([writing, reading]);

    expect(read).toEqual({
      "dashboard-theme:wall": origin("dashboard-theme", "catalogue-wall"),
      "widget-pack:office": origin("widget-pack", "catalogue-office"),
    });
  });

  it("answers a row by kind and installed id, and nothing for another kind", async () => {
    await store.write(
      "widget-pack",
      "shared",
      origin("widget-pack", "catalogue-pack"),
    );
    const all = await store.read();

    expect(catalogueOriginOf(all, "widget-pack", "shared")).toEqual(
      origin("widget-pack", "catalogue-pack"),
    );
    expect(catalogueOriginOf(all, "dashboard-theme", "shared")).toBeUndefined();
  });
});
