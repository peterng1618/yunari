import type { InstalledExtension } from "@yunari/extension-api";
import {
  type CatalogueOrigin,
  DASHBOARD_THEME_KIND,
  type FacetRecord,
} from "@yunari/renderer-core";
import { describe, expect, it, vi } from "vitest";
import { fixtureEntry } from "../store-mode/item-fixture.js";
import type { ThemeLibraryEntry } from "../theme-library-client.js";
import {
  catalogueSourceFor,
  type EditorThemeRow,
  type ExtensionRow,
  type LibraryClients,
  librarySourceFor,
  type PathPresetRow,
  type WidgetPackRow,
} from "./sources.js";

/**
 * One source per Library page, over the two halves the store already reads.
 *
 * **The catalogue half filter is the page's member kind, not its listing kind.**
 * A widget pack is one listing that carries many widgets, so a page that browses
 * widgets has to ask what a listing contains — the listing kind alone cannot
 * answer it. The same rule filters the local half, so both halves agree about
 * what a page shows.
 */

const FACETS: FacetRecord = {
  author: "mira-k",
  colourMode: "dark",
  sensors: [],
  tags: ["retro"],
  orientation: "landscape",
  aspect: "16:9",
  width: 1920,
  height: 1080,
};

const CATALOGUE_ID = "5f0c4f30-0f8c-4e4f-9c1f-1f0f0f0f0f0f";
const OTHER_ID = "6a1d5a41-1f9d-5f5a-ad2f-2f2f2f2f2f2f";

function origin(kind: CatalogueOrigin["kind"]): CatalogueOrigin {
  return {
    kind,
    catalogueId: CATALOGUE_ID,
    version: "1.0.0",
    installedAt: "2026-10-14T00:00:00.000Z",
  };
}

/** One catalogue index entry: the fields the parser requires, plus `members`. */
function entry(
  overrides: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    id: OTHER_ID,
    kind: "widget-pack",
    name: "Starter Cards",
    version: "1.0.0",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-14T00:00:00.000Z",
    downloads: 42,
    favorites: 7,
    packageUrl: "https://store.test/starter.zip",
    thumbnail: "catalogue/starter/thumbnail.png",
    members: [],
    facets: FACETS,
    ...overrides,
  };
}

function catalogueServing(entries: readonly unknown[]): typeof fetch {
  return vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          generatedAt: "2026-10-21T00:00:00.000Z",
          entries,
        }),
        { status: 200 },
      ),
  ) as unknown as typeof fetch;
}

describe("the catalogue's page source", () => {
  it("maps a catalogue entry's members and includes", async () => {
    const themes = catalogueSourceFor("dashboard-themes", {
      fetch: catalogueServing([
        entry({
          id: OTHER_ID,
          kind: "dashboard-theme",
          name: "Living room",
          members: [
            { id: "living-room", kind: "dashboard-theme", name: "Living room" },
          ],
        }),
      ]),
    });
    const collections = catalogueSourceFor("collections", {
      fetch: catalogueServing([
        entry({
          id: OTHER_ID,
          kind: "collection",
          name: "Bundle",
          members: [],
          includes: [{ id: CATALOGUE_ID, optional: true }],
        }),
      ]),
    });

    const [theme] = (await themes.list()).rows;
    const [collection] = (await collections.list()).rows;

    expect(theme?.members).toEqual([
      { id: "living-room", kind: "dashboard-theme", name: "Living room" },
    ]);
    expect(theme?.includes).toBeUndefined();
    expect(collection?.members).toEqual([]);
    // The row keeps the wire's optional flag: a declined optional member must
    // not be counted as required by `collectionStateOf`.
    expect(collection?.includes).toEqual([
      { id: CATALOGUE_ID, optional: true },
    ]);
  });

  it("keeps an unknown member kind in the listing", async () => {
    const source = catalogueSourceFor("dashboard-themes", {
      fetch: catalogueServing([
        entry({
          id: OTHER_ID,
          kind: "dashboard-theme",
          members: [
            { id: "living-room", kind: "dashboard-theme", name: "Living room" },
            { id: "future", kind: "future-thing", name: "Future" },
          ],
        }),
      ]),
    });

    const [item] = (await source.list()).rows;

    expect(item?.members.map((member) => member.kind)).toEqual([
      "dashboard-theme",
      "future-thing",
    ]);
  });

  it("filters a page to the listings carrying its member kind", async () => {
    const widgets = catalogueSourceFor("widgets", {
      fetch: catalogueServing([
        entry({
          id: "packed",
          members: [{ id: "card", kind: "widget", name: "Card" }],
        }),
        entry({ id: "empty" }),
        entry({
          id: "theme",
          kind: "dashboard-theme",
          members: [{ id: "t", kind: "dashboard-theme", name: "Theme" }],
        }),
      ]),
    });
    const sensors = catalogueSourceFor("sensor-providers", {
      fetch: catalogueServing([
        entry({
          id: "sensor-plugin",
          kind: "plugin",
          members: [{ id: "cpu", kind: "sensor-provider", name: "CPU" }],
        }),
        entry({
          id: "data-plugin",
          kind: "plugin",
          members: [{ id: "disk", kind: "data-source", name: "Disk" }],
        }),
        entry({
          id: "asset-plugin",
          kind: "plugin",
          members: [{ id: "icons", kind: "asset-source", name: "Icons" }],
        }),
      ]),
    });
    const collections = catalogueSourceFor("collections", {
      fetch: catalogueServing([
        entry({
          id: "bundle",
          kind: "collection",
          members: [],
          includes: [{ id: CATALOGUE_ID, optional: true }],
        }),
        entry({
          id: "packed",
          members: [{ id: "card", kind: "widget", name: "Card" }],
        }),
      ]),
    });

    expect((await widgets.list()).rows.map((item) => item.id)).toEqual([
      "packed",
    ]);
    expect((await sensors.list()).rows.map((item) => item.id)).toEqual([
      "sensor-plugin",
      "data-plugin",
    ]);
    expect((await collections.list()).rows.map((item) => item.id)).toEqual([
      "bundle",
    ]);
    expect(widgets.memberKind).toBe("widget");
    expect(sensors.memberKind).toBe("sensor-provider");
    expect(collections.memberKind).toBe("collection");
  });

  it("rejects a failed read rather than answering an empty listing", async () => {
    const failing = vi.fn(
      async () => new Response("", { status: 500 }),
    ) as unknown as typeof fetch;
    const source = catalogueSourceFor("widgets", { fetch: failing });

    await expect(source.list()).rejects.toThrow("500");
  });
});

describe("the library's page source", () => {
  /** The port's readers, each answering nothing unless a case replaces it, so a
   *  case that reads the wrong listing draws an empty page rather than a row. */
  function clients(overrides: Partial<LibraryClients> = {}): LibraryClients {
    return {
      themes: async () => [],
      editorThemes: async () => [],
      widgetPacks: async () => [],
      pathPresets: async () => [],
      extensions: async () => [],
      ...overrides,
    };
  }

  function plugin(overrides: Partial<InstalledExtension> = {}): ExtensionRow {
    return {
      key: "acme/monitors",
      name: "Acme Monitors",
      publisher: "acme",
      version: "2.1.0",
      execution: "trusted-worker",
      capabilities: ["sensor:provide"],
      contributions: {},
      devices: [],
      consent: "granted",
      fingerprint: "a".repeat(64),
      ...overrides,
    };
  }

  function theme(originRecord: CatalogueOrigin): ThemeLibraryEntry {
    return {
      ...fixtureEntry({
        id: "living-room",
        name: "Living room",
        author: "mira-k",
        version: "1.4.0",
      }),
      origin: originRecord,
    };
  }

  it("maps each host listing to the same StoreItem shape", async () => {
    const editorTheme: EditorThemeRow = {
      id: CATALOGUE_ID,
      name: "Office",
      origin: origin("editor-theme"),
    };
    const pack: WidgetPackRow = {
      id: OTHER_ID,
      name: "Starter Cards",
      version: "1.0.0",
      units: [{ id: "card-1", label: "Card 1" }],
      origin: origin("widget-pack"),
    };
    const preset: PathPresetRow = {
      id: "pack:pack-one:wave",
      label: "Wave",
      data: "M0 0 L1 1",
      paint: "stroke",
      origin: origin("path-preset-pack"),
    };
    const userPreset: PathPresetRow = {
      id: "user:mine",
      label: "Mine",
      data: "M0 0 L2 2",
      paint: "fill",
    };
    const sensorPlugin = plugin({
      contributions: {
        sensorProviders: [{ id: "cpu", label: "CPU" }],
        customSources: [{ id: "disk", name: "Disk" }],
      },
    });

    const themes = await librarySourceFor(
      "dashboard-themes",
      clients({ themes: async () => [theme(origin("dashboard-theme"))] }),
    )
      .list()
      .then((read) => read.rows);
    const appThemes = await librarySourceFor(
      "app-themes",
      clients({ editorThemes: async () => [editorTheme] }),
    )
      .list()
      .then((read) => read.rows);
    const widgets = await librarySourceFor(
      "widgets",
      clients({ widgetPacks: async () => [pack] }),
    )
      .list()
      .then((read) => read.rows);
    const shapes = await librarySourceFor(
      "shapes",
      clients({ pathPresets: async () => [preset, userPreset] }),
    )
      .list()
      .then((read) => read.rows);
    const sensors = await librarySourceFor(
      "sensor-providers",
      clients({ extensions: async () => [sensorPlugin] }),
    )
      .list()
      .then((read) => read.rows);

    expect(themes[0]).toMatchObject({
      id: "living-room",
      kind: DASHBOARD_THEME_KIND,
      name: "Living room",
      author: "mira-k",
      version: "1.4.0",
      catalogue: undefined,
      members: [
        { id: "living-room", kind: "dashboard-theme", name: "Living room" },
      ],
    });
    expect(themes[0]?.origin).toEqual(origin("dashboard-theme"));
    expect(themes[0]?.facets).toBeDefined();

    expect(appThemes[0]).toMatchObject({
      id: CATALOGUE_ID,
      kind: "editor-theme",
      name: "Office",
      catalogue: undefined,
      // The store's rule: an editor theme's document carries no id, so the
      // member's id is its validated name, not the host's file id.
      members: [{ id: "Office", kind: "editor-theme", name: "Office" }],
    });
    expect(appThemes[0]?.origin).toEqual(origin("editor-theme"));

    expect(widgets[0]).toMatchObject({
      id: OTHER_ID,
      kind: "widget-pack",
      name: "Starter Cards",
      version: "1.0.0",
      members: [{ id: "card-1", kind: "widget", name: "Card 1" }],
    });
    expect(widgets[0]?.origin).toEqual(origin("widget-pack"));

    // A pack's preset row carries its pack's origin from the host; a user
    // preset names no pack and carries none.
    expect(shapes[0]).toMatchObject({
      id: "pack:pack-one:wave",
      kind: "shape",
      name: "Wave",
      members: [{ id: "pack:pack-one:wave", kind: "shape", name: "Wave" }],
    });
    expect(shapes[0]?.origin).toEqual(origin("path-preset-pack"));
    expect(shapes[1]?.origin).toBeUndefined();

    expect(sensors[0]).toMatchObject({
      id: "acme/monitors",
      kind: "plugin",
      name: "Acme Monitors",
      author: "acme",
      version: "2.1.0",
      members: [
        { id: "cpu", kind: "sensor-provider", name: "CPU" },
        { id: "disk", kind: "data-source", name: "Disk" },
      ],
    });
    expect(sensors[0]?.origin).toBeUndefined();
  });

  it("drops a local row the page's member kind does not answer", async () => {
    const emptyPack: WidgetPackRow = {
      id: OTHER_ID,
      name: "Empty",
      version: "1.0.0",
      units: [],
    };
    const assetPlugin = plugin({
      key: "acme/icons",
      contributions: { assetSources: [{ id: "icons", label: "Icons" }] },
    });

    const widgets = await librarySourceFor(
      "widgets",
      clients({ widgetPacks: async () => [emptyPack] }),
    )
      .list()
      .then((read) => read.rows);
    const sensors = await librarySourceFor(
      "sensor-providers",
      clients({ extensions: async () => [assetPlugin] }),
    )
      .list()
      .then((read) => read.rows);
    const assets = await librarySourceFor(
      "asset-sources",
      clients({ extensions: async () => [assetPlugin] }),
    )
      .list()
      .then((read) => read.rows);

    expect(widgets).toEqual([]);
    expect(sensors).toEqual([]);
    expect(assets[0]?.members).toEqual([
      { id: "icons", kind: "asset-source", name: "Icons" },
    ]);
  });

  it("reads only the listing its page names", async () => {
    const themes = vi.fn(async () => [] as readonly ThemeLibraryEntry[]);
    const packs = vi.fn(async () => [] as readonly WidgetPackRow[]);
    const source = librarySourceFor(
      "widgets",
      clients({ themes, widgetPacks: packs }),
    );

    await source.list();

    expect(packs).toHaveBeenCalledOnce();
    expect(themes).not.toHaveBeenCalled();
    expect(source.page).toBe("widgets");
    expect(source.memberKind).toBe("widget");
  });
});

/** The Sensor providers sub-filter is the page rule's own list, so the options
 *  and the filter cannot drift from what the page browses. */
it("exposes the member kinds each page browses", () => {
  expect(catalogueSourceFor("sensor-providers").memberKinds).toEqual([
    "sensor-provider",
    "data-source",
  ]);
  expect(
    librarySourceFor("sensor-providers", {
      themes: async () => [],
      editorThemes: async () => [],
      widgetPacks: async () => [],
      pathPresets: async () => [],
      extensions: async () => [],
    }).memberKinds,
  ).toEqual(["sensor-provider", "data-source"]);
});

/** **A member list that could not be read is refused, not drawn empty.** An
 *  empty list is the fact that a listing carries none; a host row that names
 *  members the reader could not parse is a different fact, and the page states
 *  it like the catalogue's own refusals. */
it("refuses a host row whose member list could not be read", async () => {
  const broken = {
    id: OTHER_ID,
    name: "Broken pack",
    version: "1.0.0",
    units: "not a list",
  } as unknown as WidgetPackRow;
  const read = await librarySourceFor("widgets", {
    themes: async () => [],
    editorThemes: async () => [],
    widgetPacks: async () => [broken],
    pathPresets: async () => [],
    extensions: async () => [],
  }).list();

  expect(read.rows, "an unreadable pack was drawn as an empty one").toEqual([]);
  expect(read.refused).toEqual([
    { kind: "widget-pack", reason: "malformed", count: 1 },
  ]);
});
