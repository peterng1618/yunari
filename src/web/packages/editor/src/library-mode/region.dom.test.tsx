// @vitest-environment jsdom

/**
 * The Library region: the navigation column, the state filter's effect on what
 * the grid draws, the Sensor providers sub-filter, a failed read, and the My
 * submissions page.
 *
 * The region is mounted directly with the page and state the shell hoists (R1),
 * so each case names the surface it reads instead of driving the header first.
 * jsdom lays nothing out: the grid is read by its cells' data attributes, which
 * the gallery already owns. The item surface a card opens is
 * `region-detail.dom.test.tsx`'s.
 */
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { uiCopy } from "../ui-copy.js";
import {
  answering,
  CATALOGUE,
  entry,
  indexOf,
  json,
  mountHarness,
  must,
  unmount,
  waitForCells,
} from "./region-harness.js";

afterEach(async () => {
  await unmount();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

it("draws the navigation column grouped Browse and Publish", async () => {
  vi.stubGlobal(
    "fetch",
    answering([
      [CATALOGUE, () => indexOf([])],
      ["/api/widget-packs", () => json({ packs: [] })],
    ]),
  );
  const onPage = vi.fn();
  const container = await mountHarness("widgets", "all", onPage);

  const nav = must(
    container.querySelector("[data-yunari-library-nav]"),
    "navigation column",
  );
  const items = [...nav.querySelectorAll<HTMLButtonElement>("button")];
  expect(
    items.map((item) => item.textContent?.trim()),
    "the column does not name the nine destinations, in order",
  ).toEqual([
    uiCopy.library.pages.dashboardThemes,
    uiCopy.library.pages.appThemes,
    uiCopy.library.pages.widgets,
    uiCopy.library.pages.shapes,
    uiCopy.library.pages.sensorProviders,
    uiCopy.library.pages.assetSources,
    uiCopy.library.pages.panelDrivers,
    uiCopy.library.pages.collections,
    uiCopy.library.pages.submissions,
  ]);
  const groups = [...nav.querySelectorAll("[data-yunari-library-nav-group]")];
  expect(groups.map((group) => group.textContent?.trim())).toEqual([
    uiCopy.library.groups.browse,
    uiCopy.library.groups.publish,
  ]);
  // Keyboard: the column is one tab stop and the arrows move between rows, so
  // exactly the selected destination carries `tabindex="0"`.
  for (const item of items) {
    expect(item.tagName).toBe("BUTTON");
    expect(item.disabled).toBe(false);
  }
  const tabStops = items.filter(
    (item) => item.getAttribute("tabindex") !== "-1",
  );
  expect(tabStops, "the column has no keyboard tab stop").toHaveLength(1);
  expect(items[2]?.getAttribute("aria-selected")).toBe("true");
  expect(tabStops[0]).toBe(items[2]);

  await act(async () => items[0]?.click());
  expect(onPage).toHaveBeenCalledWith("dashboard-themes");
});

it("filters the visible rows by the state", async () => {
  /** One installed copy of a catalogue pack: its id names no catalogue row of
   *  its own, and the origin names the entry it came from. */
  const installedOrigin = {
    kind: "widget-pack",
    catalogueId: "installed-pack",
    version: "1.0.0",
    installedAt: "2026-10-01T00:00:00.000Z",
  };
  vi.stubGlobal(
    "fetch",
    answering([
      [
        CATALOGUE,
        () =>
          indexOf([
            entry("widget-pack", "catalogue-pack", "Catalogue pack", [
              { id: "w1", kind: "widget", name: "Widget" },
            ]),
            entry("widget-pack", "installed-pack", "Installed pack", [
              { id: "w2", kind: "widget", name: "Widget" },
            ]),
          ]),
      ],
      [
        "/api/widget-packs",
        () =>
          json({
            packs: [
              {
                id: "installed-pack",
                name: "Installed copy",
                version: "1.0.0",
                units: [{ id: "u1", label: "Unit" }],
                origin: installedOrigin,
              },
              {
                id: "local-pack",
                name: "Local pack",
                version: "1.0.0",
                units: [{ id: "u2", label: "Unit" }],
              },
            ],
          }),
      ],
    ]),
  );

  const all = await mountHarness("widgets", "all");
  await waitForCells(all, ["Catalogue pack", "Installed pack", "Local pack"]);

  // On this PC: the installed catalogue copy and the pack no catalogue lists.
  const installed = await mountHarness("widgets", "on-this-pc");
  await waitForCells(installed, ["Installed pack", "Local pack"]);

  const available = await mountHarness("widgets", "not-installed");
  await waitForCells(available, ["Catalogue pack"]);
});

/**
 * **A collection's state is its includes'**, so the filter reads the register
 * the card reads. A collection with every include installed is *On this PC*,
 * and so is a partially installed one — it has copies on this PC and reads its
 * count with Update. Only a collection with no include installed is *Not
 * installed*.
 */
it("filters collections by the includes the register names", async () => {
  const includeIds = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444",
  ] as const;
  const includes = includeIds.map((id) => ({ id, optional: false }));
  const originsOf = (held: readonly string[]): Response =>
    json({
      origins: held.map((catalogueId) => ({
        kind: "dashboard-theme",
        catalogueId,
        version: "1.0.0",
        installedAt: "2026-10-01T00:00:00.000Z",
      })),
    });
  const catalogue = () =>
    indexOf([
      entry("collection", "ops-collection", "Ops collection", [], { includes }),
    ]);
  const serve = (held: readonly string[]): void => {
    vi.stubGlobal(
      "fetch",
      answering([
        [CATALOGUE, catalogue],
        ["/api/store/origins", () => originsOf(held)],
      ]),
    );
  };

  serve(includeIds);
  const installed = await mountHarness("collections", "on-this-pc");
  await waitForCells(installed, ["Ops collection"]);

  serve(includeIds.slice(0, 2));
  const partialOnThisPc = await mountHarness("collections", "on-this-pc");
  await waitForCells(partialOnThisPc, ["Ops collection"]);

  const partialNotInstalled = await mountHarness(
    "collections",
    "not-installed",
  );
  await vi.waitFor(() =>
    expect(
      partialNotInstalled.querySelector("[data-yunari-library-empty]"),
      "the partial collection was listed as not installed",
    ).not.toBeNull(),
  );

  serve([]);
  const absent = await mountHarness("collections", "not-installed");
  await waitForCells(absent, ["Ops collection"]);
});

it("draws one row for an installed copy, not a library row beside it", async () => {
  vi.stubGlobal(
    "fetch",
    answering([
      [
        CATALOGUE,
        () =>
          indexOf([
            entry("widget-pack", "catalogue-pack", "Catalogue pack", [
              { id: "w1", kind: "widget", name: "Widget" },
            ]),
          ]),
      ],
      [
        "/api/widget-packs",
        () =>
          json({
            packs: [
              {
                id: "catalogue-pack",
                name: "Installed copy",
                version: "1.0.0",
                units: [{ id: "u1", label: "Unit" }],
                origin: {
                  kind: "widget-pack",
                  catalogueId: "catalogue-pack",
                  version: "1.0.0",
                  installedAt: "2026-10-01T00:00:00.000Z",
                },
              },
            ],
          }),
      ],
    ]),
  );

  const container = await mountHarness("widgets", "all");
  await waitForCells(container, ["Catalogue pack"]);
});

it("keeps an installed copy whose catalogue row is not listed", async () => {
  vi.stubGlobal(
    "fetch",
    answering([
      [
        CATALOGUE,
        () =>
          indexOf([
            entry("widget-pack", "catalogue-pack", "Catalogue pack", [
              { id: "w1", kind: "widget", name: "Widget" },
            ]),
          ]),
      ],
      [
        "/api/widget-packs",
        () =>
          json({
            packs: [
              {
                id: "gone-pack",
                name: "Orphan copy",
                version: "1.0.0",
                units: [{ id: "u1", label: "Unit" }],
                origin: {
                  kind: "widget-pack",
                  catalogueId: "unpublished-pack",
                  version: "1.0.0",
                  installedAt: "2026-10-01T00:00:00.000Z",
                },
              },
            ],
          }),
      ],
    ]),
  );

  // Its catalogue entry is not in this listing, so the installed copy is the
  // only row left to see and to remove.
  const container = await mountHarness("widgets", "all");
  await waitForCells(container, ["Catalogue pack", "Orphan copy"]);
});

it("filters the Sensor providers page between Sensors and Data sources", async () => {
  vi.stubGlobal(
    "fetch",
    answering([
      [
        CATALOGUE,
        () =>
          indexOf([
            entry("plugin", "sensor-plugin", "Sensor plugin", [
              { id: "s", kind: "sensor-provider", name: "CPU" },
            ]),
            entry("plugin", "data-plugin", "Data plugin", [
              { id: "d", kind: "data-source", name: "Weather" },
            ]),
          ]),
      ],
      ["/api/extensions", () => json({ extensions: [] })],
    ]),
  );

  const container = await mountHarness("sensor-providers", "all");
  await waitForCells(container, ["Sensor plugin"]);

  const subFilter = [
    ...container.querySelectorAll<HTMLButtonElement>(
      "[data-yunari-library-sensors] button",
    ),
  ];
  expect(
    subFilter.map((button) => button.textContent?.trim()),
    "the sub-filter does not name the two member kinds",
  ).toEqual([
    uiCopy.library.sensors.sensors,
    uiCopy.library.sensors.dataSources,
  ]);
  for (const button of subFilter) {
    expect(button.tagName).toBe("BUTTON");
    expect(button.disabled).toBe(false);
  }
  expect(
    subFilter.filter((button) => button.getAttribute("tabindex") !== "-1"),
    "the sub-filter has no keyboard tab stop",
  ).toHaveLength(1);
  expect(
    container
      .querySelector("[data-yunari-library-sensors]")
      ?.getAttribute("aria-label"),
    "the sub-filter group has no programmatic name",
  ).toBe(uiCopy.library.sensors.label);

  await act(async () => subFilter[1]?.click());
  await waitForCells(container, ["Data plugin"]);
});

it("states a failed read with retry instead of drawing an empty listing", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }),
  );
  const container = await mountHarness("widgets", "all");

  await vi.waitFor(() =>
    expect(
      container.querySelector("[data-yunari-store-failure]"),
      "a failed read drew no failure",
    ).not.toBeNull(),
  );
  expect(container.textContent).toContain(uiCopy.store.unreadable.online);
  expect(container.textContent).toContain(uiCopy.store.unreadable.local);
  expect(container.querySelector("[data-yunari-store-retry]")).not.toBeNull();
  expect(
    container.querySelector("[data-yunari-library-empty]"),
    "a failed read was drawn as an empty listing",
  ).toBeNull();
  expect(container.querySelectorAll("[data-yunari-store-cell]")).toHaveLength(
    0,
  );
});

it("publishes no count when one half failed", async () => {
  vi.stubGlobal(
    "fetch",
    answering([
      [CATALOGUE, () => indexOf([])],
      ["/api/widget-packs", () => new Response("", { status: 500 })],
    ]),
  );
  const onStatus = vi.fn();
  const container = await mountHarness("widgets", "all", undefined, onStatus);

  await vi.waitFor(() =>
    expect(
      container.querySelector("[data-yunari-store-failure]"),
      "the failed half drew no failure",
    ).not.toBeNull(),
  );
  // A failed read is not an empty result: neither "0" nor the surviving
  // half's length may stand for it.
  expect(
    onStatus.mock.calls.map((call) => call[0]),
    "a count was published from a failed read",
  ).not.toContain(0);
  expect(onStatus.mock.calls.map((call) => call[0])).toEqual(
    onStatus.mock.calls.map(() => undefined),
  );
});

it("draws My submissions as the author's listing, not a pending sentence", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status: 404 })),
  );
  const container = await mountHarness("submissions");

  expect(
    container.querySelector("[data-yunari-submissions-page]"),
    "My submissions drew no listing",
  ).not.toBeNull();
  expect(container.textContent).not.toContain(uiCopy.library.submissions.empty);
});
