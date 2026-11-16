// @vitest-environment jsdom

/**
 * The item surface a Library card opens: the member kind's own actions, the
 * collections the item belongs to, and the origin register a detail open
 * re-reads.
 *
 * The region and its state filters are `region.dom.test.tsx`'s; these cases
 * mount the same harness and read the modal the card's press opens.
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
