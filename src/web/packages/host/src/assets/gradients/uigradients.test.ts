import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetSource, SourceContext } from "../source.js";

const CATALOGUE_URL =
  "https://raw.githubusercontent.com/ghosh/uiGradients/main/gradients.json";

const DEEP_SEA = { name: "Deep Sea", colors: ["#091E3A", "#2F80ED"] };
const SUNRISE = { name: "Sunrise", colors: ["#ff512f", "#f09819", "#f9d423"] };

function catalogue(entries: readonly unknown[]): string {
  return JSON.stringify(entries);
}

function context(fetcher: typeof fetch): SourceContext {
  return {
    credential: () => undefined,
    signal: new AbortController().signal,
    fetch: fetcher,
  };
}

function stubFetch(entries: readonly unknown[]) {
  const fetcher = vi.fn(
    async () => new Response(catalogue(entries), { status: 200 }),
  );
  return { fetcher, fetch: fetcher as unknown as typeof fetch };
}

function numbered(count: number): readonly unknown[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `Gradient ${index + 1}`,
    colors: ["#000000", "#ffffff"],
  }));
}

let uigradientsSource: AssetSource;

beforeEach(async () => {
  vi.resetModules();
  // The catalogue cache is module-level, so each case asks a fresh module.
  ({ uigradientsSource } = await import("./uigradients.js"));
});

describe("uigradientsSource", () => {
  it("turns two colours into two evenly spaced stops at angle 0", async () => {
    const { fetch } = stubFetch([DEEP_SEA]);

    const page = await uigradientsSource.search("", 1, context(fetch));

    expect(page.results[0]?.preset).toEqual({
      kind: "gradient",
      angle: 0,
      stops: [
        { offset: 0, color: "#091E3A" },
        { offset: 1, color: "#2F80ED" },
      ],
    });
    expect(page.results[0]?.id).toBe("0");
    expect(page.results[0]?.name).toBe("Deep Sea");
    expect(page.results[0]?.kind).toBe("gradient");
    expect(page.results[0]?.subtitle).toBeUndefined();
  });

  it("spaces three colours at 0, 0.5 and 1", async () => {
    const { fetch } = stubFetch([SUNRISE]);

    const page = await uigradientsSource.search("", 1, context(fetch));

    expect(page.results[0]?.preset).toEqual({
      kind: "gradient",
      angle: 0,
      stops: [
        { offset: 0, color: "#ff512f" },
        { offset: 0.5, color: "#f09819" },
        { offset: 1, color: "#f9d423" },
      ],
    });
  });

  it("carries the MIT licence and the project page, and names no host", async () => {
    const { fetch } = stubFetch([DEEP_SEA]);

    const page = await uigradientsSource.search("", 1, context(fetch));

    expect(page.results[0]?.licence).toBe("MIT");
    expect(page.results[0]?.sourceUrl).toBe(
      "https://github.com/ghosh/uiGradients",
    );
    // The catalogue is fetched once and filtered locally, so a search term
    // never reaches a host.
    expect(uigradientsSource.host).toBeNull();
    expect(uigradientsSource.presetKind).toBe("gradient");
    expect(uigradientsSource.category).toBe("colour");
  });

  it("filters names case-insensitively and pages at 40", async () => {
    const { fetch } = stubFetch([...numbered(44), DEEP_SEA]);

    const first = await uigradientsSource.search("", 1, context(fetch));
    expect(first.results).toHaveLength(40);
    expect(first.totalPages).toBe(2);

    const second = await uigradientsSource.search("", 2, context(fetch));
    expect(second.results).toHaveLength(5);
    expect(second.results.map((result) => result.id)).toEqual([
      "40",
      "41",
      "42",
      "43",
      "44",
    ]);
    expect(second.results[4]?.name).toBe("Deep Sea");

    const byName = await uigradientsSource.search(
      "deep sea",
      1,
      context(fetch),
    );
    expect(byName.results.map((result) => result.name)).toEqual(["Deep Sea"]);

    const loud = await uigradientsSource.search("DEEP SEA", 1, context(fetch));
    expect(loud.results.map((result) => result.name)).toEqual(["Deep Sea"]);
  });

  it("fetches the catalogue once for two searches", async () => {
    const { fetcher, fetch } = stubFetch([DEEP_SEA]);
    const ctx = context(fetch);

    await uigradientsSource.search("", 1, ctx);
    await uigradientsSource.search("", 2, ctx);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(CATALOGUE_URL);
  });

  it("keeps the catalogue load when the search that started it is aborted", async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Fails on abort the way a real fetch does, so a borrowed request signal
    // would take the shared load down with the first search.
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
          void gate.then(() =>
            resolve(new Response(catalogue([DEEP_SEA]), { status: 200 })),
          );
        }),
    ) as unknown as typeof fetch;

    const first = new AbortController();
    const firstCtx = { ...context(fetcher), signal: first.signal };
    const secondCtx = context(fetcher);

    const firstSearch = uigradientsSource.search("", 1, firstCtx);
    // Mark it handled now: the point is the second search, not this one.
    firstSearch.catch(() => undefined);
    const secondSearch = uigradientsSource.search("", 1, secondCtx);

    first.abort();
    release();

    const page = await secondSearch;
    expect(page.results.map((result) => result.name)).toEqual(["Deep Sea"]);
    await expect(firstSearch).resolves.toMatchObject({ totalPages: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("clears a failed fetch so the next search retries", async () => {
    let attempts = 0;
    const fetcher = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("offline");
      return new Response(catalogue([DEEP_SEA]), { status: 200 });
    });
    const ctx = context(fetcher as unknown as typeof fetch);

    await expect(uigradientsSource.search("", 1, ctx)).rejects.toThrow(
      "offline",
    );

    const page = await uigradientsSource.search("", 1, ctx);
    expect(page.results.map((result) => result.name)).toEqual(["Deep Sea"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("drops an entry with fewer than two valid colours", async () => {
    const { fetch } = stubFetch([
      DEEP_SEA,
      { name: "Bad Hex", colors: ["#112233", "not-a-colour"] },
      { name: "One Colour", colors: ["#112233"] },
      { name: "Not A List", colors: "#112233" },
      { name: 7, colors: ["#112233", "#445566"] },
      { colors: ["#112233", "#445566"] },
      { name: "Sparse", colors: ["#112233", null, "#445566"] },
    ]);

    const page = await uigradientsSource.search("", 1, context(fetch));
    expect(page.results.map((result) => result.name)).toEqual([
      "Deep Sea",
      "Sparse",
    ]);
  });

  it("fails loudly when the catalogue does not answer a list", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ gradients: [] }), { status: 200 }),
    );
    const ctx = context(fetcher as unknown as typeof fetch);

    await expect(uigradientsSource.search("", 1, ctx)).rejects.toThrow(
      "UI Gradients",
    );
  });
});
