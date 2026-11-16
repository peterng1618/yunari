// @vitest-environment jsdom

/**
 * The Library region: the navigation column, the state filter's effect on what
 * the grid draws, the Sensor providers sub-filter, and a failed read.
 *
 * The region is mounted directly with the page and state the shell hoists (R1),
 * so each case names the surface it reads instead of driving the header first.
 * jsdom lays nothing out: the grid is read by its cells' data attributes, which
 * the gallery already owns.
 */
import { cataloguePackageUrl } from "@yunari/renderer-core";
import { act, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { uiCopy } from "../ui-copy.js";
import { LibraryRegion, type LibraryState } from "./region.js";
import type { LibraryPage } from "./sources.js";

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as never;
Element.prototype.getAnimations ??= (): never[] => [];
window.PointerEvent ??= MouseEvent as never;
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  const matches = Element.prototype.matches;
  Element.prototype.matches = Object.assign(function (
    this: Element,
    selector: string,
  ): boolean {
    if (selector === ":modal" || selector === ":popover-open") return false;
    return matches.call(this, selector);
  }, matches);
});

let root: Root | undefined;
let host: HTMLDivElement | undefined;

async function unmount(): Promise<void> {
  const mounted = root;
  root = undefined;
  host?.remove();
  host = undefined;
  if (mounted !== undefined) await act(async () => mounted.unmount());
}

afterEach(async () => {
  await unmount();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

async function mount(element: ReactElement): Promise<HTMLDivElement> {
  await unmount();
  const container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  host = container;
  await act(async () => {
    mounted.render(element);
  });
  return container;
}

function must<T extends Element>(found: T | null, what: string): T {
  if (found === null) throw new Error(`the region rendered no ${what}`);
  return found;
}

const FACETS = {
  author: "mira-k",
  colourMode: "dark",
  sensors: [],
  tags: [],
  orientation: "landscape",
  aspect: "16:9",
  width: 1920,
  height: 1080,
};

function entry(
  kind: string,
  id: string,
  name: string,
  members: readonly { id: string; kind: string; name: string }[],
  extra: Readonly<Record<string, unknown>> = {},
): unknown {
  return {
    id,
    kind,
    name,
    version: "1.0.0",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-14T00:00:00.000Z",
    downloads: 0,
    favorites: 0,
    packageUrl: cataloguePackageUrl(id, "1.0.0"),
    thumbnail: `catalogue/${id}/thumbnail.png`,
    members,
    facets: FACETS,
    ...extra,
  };
}

function indexOf(entries: readonly unknown[]): Response {
  return new Response(
    JSON.stringify({ generatedAt: "2026-10-21T00:00:00.000Z", entries }),
    { status: 200 },
  );
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}

/** A `fetch` answering the routes a page reads, keyed by path prefix. An
 *  unmatched path is a 404 rather than a plausible empty body, so a route this
 *  case forgot is a failed read it can see. */
function answering(
  routes: readonly (readonly [string, () => Response])[],
): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [prefix, answer] of routes) {
      if (url.startsWith(prefix)) return answer();
    }
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
}

const CATALOGUE = "https://yunari-store.workers.dev/index.json";

/** The cell names the grid drew, in reading order. */
function cells(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll("[data-yunari-store-cell-name]")].map(
    (cell) => cell.textContent ?? "",
  );
}

async function waitForCells(
  container: HTMLElement,
  expected: readonly string[],
): Promise<void> {
  await vi.waitFor(() =>
    expect(
      cells(container),
      "the grid did not draw the expected cells",
    ).toEqual(expected),
  );
}

/** A controlled mount, so a case changes the page or the state the way the
 *  shell does — through the props the region is handed. */
function Harness(props: {
  readonly page: LibraryPage;
  readonly state: LibraryState;
  readonly onPage: ((page: LibraryPage) => void) | undefined;
  readonly onStatus: ((count: number | undefined) => void) | undefined;
}): React.JSX.Element {
  const [page, setPage] = useState(props.page);
  const [state, setState] = useState(props.state);
  return (
    <LibraryRegion
      page={page}
      onPage={(next) => {
        setPage(next);
        props.onPage?.(next);
      }}
      state={state}
      onState={setState}
      onStatus={props.onStatus}
    />
  );
}

async function mountHarness(
  page: LibraryPage,
  state: LibraryState = "all",
  onPage?: (page: LibraryPage) => void,
  onStatus?: (count: number | undefined) => void,
): Promise<HTMLDivElement> {
  return mount(
    <Harness page={page} state={state} onPage={onPage} onStatus={onStatus} />,
  );
}

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

/**
 * **A per-type page opens the item's own surface at the member its card draws.**
 * The listing used to hand every card a no-op open, so a widget, shape, sensor,
 * asset source, panel driver or collection could open nothing. The modal now
 * reads the page's catalogue, library and register, and its foot draws the
 * member kind's own actions.
 */
it("opens a member's detail from its card", async () => {
  vi.stubGlobal(
    "fetch",
    answering([
      [
        CATALOGUE,
        () =>
          indexOf([
            entry("widget-pack", "pack-uuid", "System pack", [
              { id: "cpu", kind: "widget", name: "CPU gauge" },
            ]),
          ]),
      ],
      ["/api/widget-packs", () => json({ packs: [] })],
    ]),
  );
  const container = await mountHarness("widgets");
  await waitForCells(container, ["System pack"]);

  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>(
        "[data-yunari-store-cell-name-press]",
      ),
      "cell name press",
    ).click(),
  );

  const modal = must(
    document.body.querySelector<HTMLElement>("[data-yunari-store-item]"),
    "item modal",
  );
  expect(
    modal.querySelector("[data-yunari-store-item-action]"),
    "the item modal drew no action for its member kind",
  ).not.toBeNull();
  expect(
    [
      ...modal.querySelectorAll<HTMLElement>("[data-yunari-store-item-action]"),
    ].map((action) => action.getAttribute("data-yunari-store-item-action")),
    "the modal does not draw the widget's actions",
  ).toEqual(["insert", "remove"]);
  expect(
    [
      ...modal.querySelectorAll<HTMLElement>("[data-yunari-store-item-action]"),
    ].map((action) => action.textContent?.trim()),
    "the modal does not name the widget's insert",
  ).toContain("Insert in canvas");
});

/** Membership comes from the session's collection entries; the Widgets page
 *  filters collections out of its own rows. */
it("lists a collection an item belongs to from another page", async () => {
  vi.stubGlobal(
    "fetch",
    answering([
      [
        CATALOGUE,
        () =>
          indexOf([
            entry(
              "widget-pack",
              "11111111-1111-4111-8111-111111111111",
              "System pack",
              [{ id: "cpu", kind: "widget", name: "CPU gauge" }],
            ),
            entry(
              "collection",
              "22222222-2222-4222-8222-222222222222",
              "Starter kit",
              [],
              {
                includes: [
                  {
                    id: "11111111-1111-4111-8111-111111111111",
                    optional: false,
                  },
                ],
              },
            ),
          ]),
      ],
      ["/api/widget-packs", () => json({ packs: [] })],
    ]),
  );
  const container = await mountHarness("widgets");
  await waitForCells(container, ["System pack"]);

  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>(
        "[data-yunari-store-cell-name-press]",
      ),
      "cell name press",
    ).click(),
  );

  await vi.waitFor(() =>
    expect(
      document.body.querySelector(
        '[data-yunari-store-detail-collection="22222222-2222-4222-8222-222222222222"]',
      )?.textContent,
      "the item does not name the collection that includes it",
    ).toBe("Starter kit"),
  );
});

/** A collection reached from Part of keeps its Install press: the register is
 *  read when any detail opens, not only on the Collections page. */
it("reads the register for a collection opened from another page", async () => {
  vi.stubGlobal(
    "fetch",
    answering([
      [
        CATALOGUE,
        () =>
          indexOf([
            entry(
              "widget-pack",
              "11111111-1111-4111-8111-111111111111",
              "System pack",
              [{ id: "cpu", kind: "widget", name: "CPU gauge" }],
            ),
            entry(
              "collection",
              "22222222-2222-4222-8222-222222222222",
              "Starter kit",
              [],
              {
                includes: [
                  {
                    id: "11111111-1111-4111-8111-111111111111",
                    optional: false,
                  },
                ],
              },
            ),
          ]),
      ],
      ["/api/widget-packs", () => json({ packs: [] })],
      ["/api/store/origins", () => json({ origins: [] })],
      [
        "/api/store/collection/plan",
        () => json({ plan: { members: [], missing: [] } }),
      ],
    ]),
  );
  const container = await mountHarness("widgets");
  await waitForCells(container, ["System pack"]);

  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>(
        "[data-yunari-store-cell-name-press]",
      ),
      "cell name press",
    ).click(),
  );
  const collectionLink = await vi.waitFor(() =>
    must(
      document.body.querySelector<HTMLButtonElement>(
        "[data-yunari-store-detail-collection] button",
      ),
      "collection link",
    ),
  );
  await act(async () => collectionLink.click());

  await vi.waitFor(() =>
    expect(
      document.body.querySelector(
        '[data-yunari-store-collection-install="install"]',
      ),
      "a collection opened from Part of offers no Install",
    ).not.toBeNull(),
  );
  expect(
    document.body.querySelector(
      '[data-yunari-store-collection-state="unavailable"]',
    ),
    "the collection's install state reads as unread after the register answered",
  ).toBeNull();
});

/** A failed collections read is stated with a retry, never as no membership. */
it("states a failed collections read instead of claiming no membership", async () => {
  let catalogueReads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith(CATALOGUE)) {
        catalogueReads += 1;
        if (catalogueReads === 1) {
          return indexOf([
            entry("widget-pack", "pack-uuid", "System pack", [
              { id: "cpu", kind: "widget", name: "CPU gauge" },
            ]),
          ]);
        }
        return new Response("", { status: 500 });
      }
      if (url.startsWith("/api/widget-packs")) return json({ packs: [] });
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch,
  );
  const container = await mountHarness("widgets");
  await waitForCells(container, ["System pack"]);

  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>(
        "[data-yunari-store-cell-name-press]",
      ),
      "cell name press",
    ).click(),
  );

  await vi.waitFor(() =>
    expect(
      document.body.querySelector(
        '[data-yunari-store-detail-part-of-state="failed"]',
      )?.textContent,
      "a failed collections read is not stated",
    ).toContain(uiCopy.store.detail.partOfFailed),
  );
  expect(
    document.body.querySelector("[data-yunari-store-detail-part-of]"),
    "a failed collections read drew an empty Part of section",
  ).toBeNull();
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
