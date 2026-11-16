// @vitest-environment jsdom

/**
 * The Library's Dashboard themes page: the state filter over catalogue and
 * local rows, the listing toolbar's facets, density and search, the
 * catalogue's refusals, the batch the sentinel loads, and the one-shot prune
 * of a restored facet choice.
 *
 * The page's stored-theme commands are `page-commands.dom.test.tsx`'s and the
 * writes that re-list a page are `page-writes.dom.test.tsx`'s; each mounts the
 * same harness.
 */
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { uiCopy } from "../ui-copy.js";
import {
  answering,
  cells,
  collectionEntry,
  entry,
  FACETS,
  indexOf,
  json,
  LOCAL_THEME,
  mountPage,
  must,
  THEME_A,
  THEME_B,
  unmount,
  waitForCells,
} from "./page-listing-harness.js";
import { LIBRARY_FACETS_KEY } from "./view-preferences.js";

afterEach(async () => {
  await unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

it("filters the Dashboard themes page by the state", async () => {
  vi.stubGlobal(
    "fetch",
    answering([
      [
        "/index.json",
        () =>
          indexOf([
            entry(THEME_A, "Catalogue theme"),
            entry(THEME_B, "Other theme"),
          ]),
      ],
      [
        "/api/themes",
        () =>
          json({
            themes: [
              {
                id: "installed-copy",
                name: "Installed copy",
                origin: {
                  kind: "dashboard-theme",
                  catalogueId: THEME_A,
                  version: "1.0.0",
                  installedAt: "2026-10-01T00:00:00.000Z",
                },
                facets: FACETS,
              },
              { id: LOCAL_THEME, name: "Local theme", facets: FACETS },
            ],
          }),
      ],
    ]),
  );

  const all = await mountPage("dashboard-themes", "all");
  await waitForCells(all, ["Catalogue theme", "Other theme", "Local theme"]);

  const installed = await mountPage("dashboard-themes", "on-this-pc");
  await waitForCells(installed, ["Catalogue theme", "Local theme"]);

  const available = await mountPage("dashboard-themes", "not-installed");
  await waitForCells(available, ["Other theme"]);
});

it("states the catalogue's refusals, one line per refused kind", async () => {
  vi.stubGlobal(
    "fetch",
    answering([
      [
        "/index.json",
        () =>
          indexOf([
            entry(THEME_A, "Catalogue theme"),
            { id: THEME_B, kind: "future-thing", name: "Future" },
          ]),
      ],
    ]),
  );
  const container = await mountPage("dashboard-themes", "all");

  await vi.waitFor(() =>
    expect(
      [...container.querySelectorAll("[data-yunari-library-refusal]")].map(
        (line) => line.textContent?.trim(),
      ),
      "the page did not state the kind it could not read",
    ).toEqual([uiCopy.store.catalogueRefused("future-thing", 1)]),
  );
});

it("filters the listing by a facet chosen in the toolbar", async () => {
  vi.stubGlobal(
    "fetch",
    answering([
      [
        "/index.json",
        () =>
          indexOf([
            entry(THEME_A, "Catalogue theme"),
            entry(THEME_B, "Other theme", {
              facets: { ...FACETS, author: "someone-else" },
            }),
          ]),
      ],
    ]),
  );
  const container = await mountPage("dashboard-themes", "all");
  await waitForCells(container, ["Catalogue theme", "Other theme"]);

  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>(
        "[data-yunari-facet='author']",
      ),
      "author facet",
    ).click(),
  );
  const option = await vi.waitFor(() =>
    must(
      document.body.querySelector<HTMLButtonElement>(
        "[data-yunari-facet-option='mira-k']",
      ),
      "author option",
    ),
  );
  await act(async () => option.click());

  await waitForCells(container, ["Catalogue theme"]);
});

it("remembers the density the toolbar chose", async () => {
  vi.stubGlobal(
    "fetch",
    answering([
      ["/index.json", () => indexOf([entry(THEME_A, "Catalogue theme")])],
    ]),
  );
  const container = await mountPage("dashboard-themes", "all");
  await waitForCells(container, ["Catalogue theme"]);

  const track = must(
    container.querySelector<HTMLInputElement>(
      "[data-yunari-store-density-track]",
    ),
    "density track",
  );
  expect(track.value, "the toolbar did not open on the default density").toBe(
    "2",
  );
  await act(async () => {
    // React reads a controlled input's change through its own value tracker, so
    // the value goes through the prototype setter the tracker wraps.
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(track, "4");
    track.dispatchEvent(new Event("input", { bubbles: true }));
  });

  expect(
    window.localStorage.getItem("yunari.editor.store-density"),
    "the chosen density was not remembered",
  ).toBe("spacious");
});

/** Type into a controlled search field through React's own value tracker. */
async function typeSearch(container: HTMLElement, text: string): Promise<void> {
  const field = must(
    container.querySelector<HTMLInputElement>("[data-yunari-library-search]"),
    "search field",
  );
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setValue?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("narrows the listing by the toolbar's search, and keeps it across a re-render", async () => {
  vi.stubGlobal(
    "fetch",
    answering([
      [
        "/index.json",
        () =>
          indexOf([
            entry(THEME_A, "Catalogue theme"),
            entry(THEME_B, "Other theme", {
              facets: { ...FACETS, author: "someone-else" },
            }),
          ]),
      ],
    ]),
  );
  const container = await mountPage("dashboard-themes", "all");
  await waitForCells(container, ["Catalogue theme", "Other theme"]);

  await typeSearch(container, "catalogue");
  await waitForCells(container, ["Catalogue theme"]);

  // A facet choice re-renders the page; the query is the page's state and the
  // field keeps what the person typed.
  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>(
        "[data-yunari-facet='author']",
      ),
      "author facet",
    ).click(),
  );
  const option = await vi.waitFor(() =>
    must(
      document.body.querySelector<HTMLButtonElement>(
        "[data-yunari-facet-option='mira-k']",
      ),
      "author option",
    ),
  );
  await act(async () => option.click());

  await waitForCells(container, ["Catalogue theme"]);
  expect(
    must(
      container.querySelector<HTMLInputElement>("[data-yunari-library-search]"),
      "search field",
    ).value,
    "the page forgot the search on a re-render",
  ).toBe("catalogue");
});

/** **A filter that leaves none is not an empty catalogue.** The two facts read
 *  with different sentences: the install prompt belongs to a read that holds
 *  nothing, and hiding a chosen filter behind it leaves the person stuck. */
it("says when a filter matched nothing, and keeps the prompt for an empty catalogue", async () => {
  vi.stubGlobal(
    "fetch",
    answering([
      ["/index.json", () => indexOf([entry(THEME_A, "Catalogue theme")])],
      ["/api/themes", () => json({ themes: [] })],
    ]),
  );
  const filtered = await mountPage("dashboard-themes", "all");
  await waitForCells(filtered, ["Catalogue theme"]);
  await typeSearch(filtered, "nothing-matches-this");
  await vi.waitFor(() =>
    expect(
      must(
        filtered.querySelector<HTMLElement>("[data-yunari-library-empty]"),
        "empty state",
      ).textContent,
      "a filter that matched nothing drew the install prompt",
    ).toContain(uiCopy.library.noMatches),
  );

  vi.stubGlobal(
    "fetch",
    answering([
      ["/index.json", () => indexOf([])],
      ["/api/themes", () => json({ themes: [] })],
    ]),
  );
  const empty = await mountPage("dashboard-themes", "all");
  await vi.waitFor(() =>
    expect(
      must(
        empty.querySelector<HTMLElement>("[data-yunari-library-empty]"),
        "empty state",
      ).textContent,
      "an empty catalogue did not draw the install prompt",
    ).toContain(uiCopy.library.empty),
  );
});

/** **A failed read must not erase a restored facet.** A failure is not an
 *  empty listing, so it never prunes the saved selection against no facets. */
it("keeps a restored facet when both reads fail", async () => {
  window.sessionStorage.setItem(
    LIBRARY_FACETS_KEY,
    JSON.stringify({ author: ["mira-k"] }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }),
  );
  const container = await mountPage("dashboard-themes", "all");
  await vi.waitFor(() =>
    expect(
      container.querySelector("[data-yunari-store-failure]"),
      "an offline mount drew no failure",
    ).not.toBeNull(),
  );

  expect(
    JSON.parse(window.sessionStorage.getItem(LIBRARY_FACETS_KEY) ?? "null"),
    "a failed read pruned the restored facet choice",
  ).toEqual({ author: ["mira-k"] });
});

/** An `IntersectionObserver` a case fires by hand: jsdom has none, and the
 *  grid's sentinel is the only observer on this surface. */
let observe: (() => void) | undefined;
class FakeObserver {
  constructor(callback: IntersectionObserverCallback) {
    observe = () => {
      callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        this as never,
      );
    };
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

it("draws another batch when the sentinel reaches the end", async () => {
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  observe = undefined;
  const entries = Array.from({ length: 30 }, (_, index) =>
    entry(
      `${String(index).padStart(2, "0")}111111-1111-4111-8111-111111111111`,
      `Theme ${String(index).padStart(2, "0")}`,
    ),
  );
  vi.stubGlobal("fetch", answering([["/index.json", () => indexOf(entries)]]));
  const container = await mountPage("dashboard-themes", "all");
  await vi.waitFor(() =>
    expect(
      cells(container).length,
      "the first render drew more than one batch",
    ).toBe(24),
  );
  if (observe === undefined) throw new Error("the grid observed no sentinel");

  await act(async () => observe?.());

  await vi.waitFor(() =>
    expect(cells(container).length, "the second batch never loaded").toBe(30),
  );
});

/** **A restored facet choice is the person's, not the first render's.** It is
 *  pruned only after a listing answers: pruning the empty first render erased
 *  the choice before it could filter anything, and pruning again after every
 *  render ate the facet they had just chosen. */
it("keeps a restored facet until the listing answers, then prunes once", async () => {
  window.sessionStorage.setItem(
    LIBRARY_FACETS_KEY,
    JSON.stringify({ author: ["mira-k"] }),
  );
  vi.stubGlobal(
    "fetch",
    answering([
      ["/index.json", () => indexOf([entry(THEME_A, "Catalogue theme")])],
    ]),
  );
  const kept = await mountPage("dashboard-themes", "all");
  await waitForCells(kept, ["Catalogue theme"]);

  expect(
    JSON.parse(window.sessionStorage.getItem(LIBRARY_FACETS_KEY) ?? "null"),
    "the first render pruned the restored choice before the listing answered",
  ).toEqual({ author: ["mira-k"] });

  // Another listing no longer offers that author: the choice is dropped, once.
  vi.stubGlobal(
    "fetch",
    answering([
      [
        "/index.json",
        () =>
          indexOf([
            entry(THEME_B, "Other theme", {
              facets: { ...FACETS, author: "someone-else" },
            }),
          ]),
      ],
    ]),
  );
  const pruned = await mountPage("dashboard-themes", "all");
  await waitForCells(pruned, ["Other theme"]);

  expect(
    JSON.parse(window.sessionStorage.getItem(LIBRARY_FACETS_KEY) ?? "null"),
    "a facet the listing no longer offers was kept",
  ).toEqual({});
});

/** **A collection is neither side until the register answers.** Its state is
 *  counted over `/api/store/origins`, so an unread register must not draw an
 *  installed collection as "Not installed" or hide it from "On this PC". */
it("leaves collections out of the state filters until the register answers", async () => {
  vi.stubGlobal(
    "fetch",
    answering([["/index.json", () => indexOf([collectionEntry()])]]),
  );

  const notInstalled = await mountPage("collections", "not-installed");
  await vi.waitFor(() =>
    expect(
      cells(notInstalled),
      "an unread register classified a collection as not installed",
    ).toEqual([]),
  );

  const onThisPc = await mountPage("collections", "on-this-pc");
  await vi.waitFor(() =>
    expect(
      cells(onThisPc),
      "an unread register drew a collection as installed",
    ).toEqual([]),
  );
});
