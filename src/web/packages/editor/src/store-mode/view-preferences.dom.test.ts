// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import type { Facet } from "./facet-row.js";
import {
  pruneStoreFacets,
  readStoreFacets,
  readStoreSort,
  rememberStoreFacets,
  rememberStoreSort,
  STORE_FACETS_KEY,
  STORE_SORT_KEY,
} from "./view-preferences.js";

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("readStoreSort", () => {
  it("opens on the defaults when the stored value is not JSON", () => {
    window.sessionStorage.setItem(STORE_SORT_KEY, "{not json");
    expect(readStoreSort()).toEqual({ local: "updatedAt", online: "updated" });
  });

  it("keeps a key the half offers and refuses one it does not", () => {
    window.sessionStorage.setItem(
      STORE_SORT_KEY,
      JSON.stringify({ local: "name", online: "name" }),
    );
    // `name` is not an online key, so that half keeps its own default.
    expect(readStoreSort()).toEqual({ local: "name", online: "updated" });
  });

  it("round-trips a chosen sort", () => {
    rememberStoreSort({ local: "name", online: "downloads" });
    expect(readStoreSort()).toEqual({ local: "name", online: "downloads" });
  });
});

describe("readStoreFacets", () => {
  it("is empty when the stored value is not JSON", () => {
    window.sessionStorage.setItem(STORE_FACETS_KEY, "]");
    expect(readStoreFacets()).toEqual({});
  });

  it("drops a facet id this build cannot answer", () => {
    window.sessionStorage.setItem(
      STORE_FACETS_KEY,
      JSON.stringify({ constructor: ["x"], author: ["ada"] }),
    );
    expect(readStoreFacets()).toEqual({ author: ["ada"] });
  });

  it("keeps only string values", () => {
    window.sessionStorage.setItem(
      STORE_FACETS_KEY,
      JSON.stringify({ author: ["ada", 2] }),
    );
    expect(readStoreFacets()).toEqual({ author: ["ada"] });
  });

  it("round-trips a chosen selection", () => {
    rememberStoreFacets({ style: ["minimal"] });
    expect(readStoreFacets()).toEqual({ style: ["minimal"] });
  });
});

describe("pruneStoreFacets", () => {
  const facets: readonly Facet[] = [
    {
      id: "author",
      name: "Author",
      options: [{ id: "ada", name: "Ada", count: 1 }],
    },
  ];

  it("drops a value the current listing no longer offers", () => {
    expect(pruneStoreFacets({ author: ["ada", "gone"] }, facets)).toEqual({
      author: ["ada"],
    });
  });

  it("drops every value of a facet the listing does not draw", () => {
    expect(pruneStoreFacets({ style: ["minimal"] }, facets)).toEqual({});
  });

  it("returns the same object when nothing was dropped", () => {
    const chosen = { author: ["ada"] } as const;
    expect(pruneStoreFacets(chosen, facets)).toBe(chosen);
  });
});
