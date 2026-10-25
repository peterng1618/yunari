import type { AssetResult } from "@yunari/renderer-core";
import { describe, expect, it, vi } from "vitest";
import { searchSources } from "./search.js";
import type { AssetSource, SourceContext } from "./source.js";

const result = (id: string): AssetResult => ({
  id,
  name: id,
  kind: "icon",
  preview: "",
  subtitle: undefined,
  licence: "unknown",
  sourceUrl: "https://example.test",
});

const context = (
  credential: (id: string) => string | undefined = () => undefined,
) => ({
  credential,
  signal: new AbortController().signal,
  fetch: globalThis.fetch,
});

function fakeSource(
  overrides: Partial<AssetSource> & Pick<AssetSource, "id">,
): AssetSource {
  return {
    label: overrides.id,
    category: "icon",
    body: "grid",
    requires: undefined,
    configurable: true,
    search: async () => ({ results: [result("1")], totalPages: 1 }),
    bytesOf: async () => undefined,
    ...overrides,
  };
}

const request = (enabled: string[], body?: "grid" | "font-picker") => ({
  query: "arrow",
  enabled,
  pages: {},
  ...(body === undefined ? {} : { body }),
});

describe("searchSources", () => {
  it("calls only the enabled sources", async () => {
    const used = vi.fn(async () => ({
      results: [result("1")],
      totalPages: 1,
    }));
    const spared = vi.fn(async () => ({
      results: [result("2")],
      totalPages: 1,
    }));

    await searchSources(request(["fake-a"]), context(), [
      fakeSource({ id: "fake-a", search: used }),
      fakeSource({ id: "fake-b", search: spared }),
    ]);

    expect(used).toHaveBeenCalledTimes(1);
    expect(spared).not.toHaveBeenCalled();
  });

  it("leaves a picker body to the editor", async () => {
    const called = vi.fn(async () => ({
      results: [result("1")],
      totalPages: 1,
    }));

    const outcome = await searchSources(request(["font-picker"]), context(), [
      fakeSource({ id: "font-picker", body: "font-picker", search: called }),
    ]);

    expect(called).not.toHaveBeenCalled();
    expect(outcome.pages).toEqual([]);
  });

  it("asks only the sources whose body the request names", async () => {
    const grid = vi.fn(async () => ({
      results: [result("1")],
      totalPages: 1,
    }));
    const font = vi.fn(async () => ({
      results: [result("2")],
      totalPages: 1,
    }));
    const sources = [
      fakeSource({ id: "grid-a", body: "grid", search: grid }),
      fakeSource({ id: "font-a", body: "font-picker", search: font }),
    ];

    await searchSources(
      request(["grid-a", "font-a"], "font-picker"),
      context(),
      sources,
    );

    expect(font).toHaveBeenCalledTimes(1);
    expect(grid).not.toHaveBeenCalled();

    await searchSources(
      request(["grid-a", "font-a"], "grid"),
      context(),
      sources,
    );

    expect(grid).toHaveBeenCalledTimes(1);
    expect(font).toHaveBeenCalledTimes(1);
  });

  it("defaults to the grid body when none is named", async () => {
    const grid = vi.fn(async () => ({
      results: [result("1")],
      totalPages: 1,
    }));
    const font = vi.fn(async () => ({
      results: [result("2")],
      totalPages: 1,
    }));

    const outcome = await searchSources(
      request(["grid-a", "font-a"]),
      context(),
      [
        fakeSource({ id: "grid-a", body: "grid", search: grid }),
        fakeSource({ id: "font-a", body: "font-picker", search: font }),
      ],
    );

    expect(grid).toHaveBeenCalledTimes(1);
    expect(font).not.toHaveBeenCalled();
    expect(outcome.pages.map((page) => page.source)).toEqual(["grid-a"]);
  });

  it("prefixes every id with its source", async () => {
    const outcome = await searchSources(request(["fake-a"]), context(), [
      fakeSource({ id: "fake-a" }),
    ]);

    expect(outcome.pages[0]?.results.map((entry) => entry.id)).toEqual([
      "fake-a:1",
    ]);
  });

  it("answers pages in registry order, not completion order", async () => {
    const slow = fakeSource({
      id: "fake-a",
      search: () =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ results: [result("1")], totalPages: 1 }),
            10,
          ),
        ),
    });
    const fast = fakeSource({ id: "fake-b" });

    const outcome = await searchSources(
      request(["fake-a", "fake-b"]),
      context(),
      [slow, fast],
    );

    expect(outcome.pages.map((page) => page.source)).toEqual([
      "fake-a",
      "fake-b",
    ]);
  });

  it("names a source's failure and keeps the other page", async () => {
    const failing = fakeSource({
      id: "fake-a",
      search: async () => {
        throw new Error("upstream said no");
      },
    });

    const outcome = await searchSources(
      request(["fake-a", "fake-b"]),
      context(),
      [failing, fakeSource({ id: "fake-b" })],
    );

    expect(outcome.pages[0]).toMatchObject({
      source: "fake-a",
      results: [],
      failure: { reason: "failed", message: "upstream said no" },
    });
    expect(outcome.pages[1]?.results).toHaveLength(1);
  });

  it("answers needs-credential without calling a keyed source", async () => {
    const called = vi.fn(async () => ({
      results: [result("1")],
      totalPages: 1,
    }));

    const outcome = await searchSources(request(["keyed"]), context(), [
      fakeSource({ id: "keyed", requires: "unsplash", search: called }),
    ]);

    expect(called).not.toHaveBeenCalled();
    expect(outcome.pages[0]?.failure).toEqual({
      reason: "needs-credential",
      credential: "unsplash",
    });
  });

  it("calls a keyed source when the credential is set", async () => {
    const called = vi.fn(async () => ({
      results: [result("1")],
      totalPages: 1,
    }));

    await searchSources(
      request(["keyed"]),
      { ...context((id) => (id === "unsplash" ? "key" : undefined)) },
      [fakeSource({ id: "keyed", requires: "unsplash", search: called })],
    );

    expect(called).toHaveBeenCalledTimes(1);
  });

  it("answers an aborted search as a failure rather than throwing", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stopped by the author"));
    const ctx: SourceContext = {
      ...context(),
      signal: controller.signal,
    };

    const outcome = await searchSources(request(["fake-a"]), ctx, [
      fakeSource({ id: "fake-a" }),
    ]);

    expect(outcome.pages[0]?.failure).toEqual({
      reason: "failed",
      message: "stopped by the author",
    });
  });
});
