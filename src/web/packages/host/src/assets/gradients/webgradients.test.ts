import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetSource, SourceContext } from "../source.js";

const CATALOGUE_URL =
  "https://raw.githubusercontent.com/itmeo/webgradients/master/gradients.json";

const WARM_FLAME = {
  name: "Warm Flame",
  index: "001",
  deg: 45,
  gradient: [
    { color: "#ff9a9e", pos: 0 },
    { color: "#fad0c4", pos: 99 },
    { color: "#fad0c4", pos: 100 },
  ],
};

const NIGHT_FADE = {
  name: "Night Fade",
  index: "002",
  deg: 90,
  gradient: [
    { color: "#a18cd1", pos: 0 },
    { color: "#fbc2eb", pos: 100 },
  ],
};

function degreesEntry(name: string, index: string, deg: number) {
  return {
    name,
    index,
    deg,
    gradient: [
      { color: "#000000", pos: 0 },
      { color: "#ffffff", pos: 100 },
    ],
  };
}

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
  return Array.from({ length: count }, (_, index) =>
    degreesEntry(
      `Gradient ${index + 1}`,
      String(index + 1).padStart(3, "0"),
      135,
    ),
  );
}

let webgradientsSource: AssetSource;

beforeEach(async () => {
  vi.resetModules();
  // The catalogue cache is module-level, so each case asks a fresh module.
  ({ webgradientsSource } = await import("./webgradients.js"));
});

describe("webgradientsSource", () => {
  it("converts a CSS degree to the editor's stored angle", async () => {
    const { fetch } = stubFetch([WARM_FLAME]);

    const page = await webgradientsSource.search(
      "Warm Flame",
      1,
      context(fetch),
    );

    expect(page.results[0]?.preset).toEqual({
      kind: "gradient",
      angle: 45,
      stops: [
        { offset: 0, color: "#ff9a9e" },
        { offset: 0.99, color: "#fad0c4" },
        { offset: 1, color: "#fad0c4" },
      ],
    });
    expect(page.results[0]?.id).toBe("001");
    expect(page.results[0]?.name).toBe("Warm Flame");
    expect(page.results[0]?.kind).toBe("gradient");
    expect(page.results[0]?.subtitle).toBeUndefined();
  });

  it("keeps the catalogue's zero-padded string index as the result id", async () => {
    const { fetch } = stubFetch([
      {
        name: "Numeric Index",
        index: 7,
        deg: 45,
        gradient: [
          { color: "#000000", pos: 0 },
          { color: "#ffffff", pos: 100 },
        ],
      },
      NIGHT_FADE,
    ]);

    const page = await webgradientsSource.search("", 1, context(fetch));

    expect(page.results.map((result) => result.id)).toEqual(["7", "002"]);
  });

  it("clamps a stop's percentage into the editor's 0–1 range", async () => {
    const { fetch } = stubFetch([
      {
        name: "Slick Carbon",
        index: "010",
        deg: 45,
        gradient: [
          { color: "#000000", pos: -20 },
          { color: "#ffffff", pos: 150 },
        ],
      },
    ]);

    const page = await webgradientsSource.search("", 1, context(fetch));

    expect(page.results[0]?.preset).toEqual({
      kind: "gradient",
      angle: 45,
      stops: [
        { offset: 0, color: "#000000" },
        { offset: 1, color: "#ffffff" },
      ],
    });
  });

  it("wraps deg 90, 180 and 270 without a negative angle", async () => {
    const { fetch } = stubFetch([
      degreesEntry("Right", "001", 90),
      degreesEntry("Down", "002", 180),
      degreesEntry("Left", "003", 270),
    ]);

    const page = await webgradientsSource.search("", 1, context(fetch));

    expect(
      page.results.map((result) =>
        result.preset?.kind === "gradient" ? result.preset.angle : undefined,
      ),
    ).toEqual([0, 270, 180]);
  });

  it("carries the MIT licence, the project page and the fetch host", async () => {
    const { fetch } = stubFetch([NIGHT_FADE]);

    const page = await webgradientsSource.search("", 1, context(fetch));

    expect(page.results[0]?.licence).toBe("MIT");
    expect(page.results[0]?.sourceUrl).toBe("https://webgradients.com/");
    expect(webgradientsSource.host).toBe("raw.githubusercontent.com");
    expect(webgradientsSource.presetKind).toBe("gradient");
    expect(webgradientsSource.category).toBe("colour");
  });

  it("filters names case-insensitively and pages at 40", async () => {
    const { fetch } = stubFetch([
      ...numbered(44),
      { ...WARM_FLAME, index: "045" },
    ]);

    const first = await webgradientsSource.search("", 1, context(fetch));
    expect(first.results).toHaveLength(40);
    expect(first.totalPages).toBe(2);

    const second = await webgradientsSource.search("", 2, context(fetch));
    expect(second.results).toHaveLength(5);
    expect(second.results.map((result) => result.id)).toEqual([
      "041",
      "042",
      "043",
      "044",
      "045",
    ]);
    expect(second.results[4]?.name).toBe("Warm Flame");

    const byName = await webgradientsSource.search(
      "warm flame",
      1,
      context(fetch),
    );
    expect(byName.results.map((result) => result.name)).toEqual(["Warm Flame"]);

    const loud = await webgradientsSource.search(
      "WARM FLAME",
      1,
      context(fetch),
    );
    expect(loud.results.map((result) => result.name)).toEqual(["Warm Flame"]);
  });

  it("fetches the catalogue once for two searches", async () => {
    const { fetcher, fetch } = stubFetch([WARM_FLAME]);
    const ctx = context(fetch);

    await webgradientsSource.search("", 1, ctx);
    await webgradientsSource.search("", 2, ctx);

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
            resolve(new Response(catalogue([WARM_FLAME]), { status: 200 })),
          );
        }),
    ) as unknown as typeof fetch;

    const first = new AbortController();
    const firstCtx = { ...context(fetcher), signal: first.signal };
    const secondCtx = context(fetcher);

    const firstSearch = webgradientsSource.search("", 1, firstCtx);
    // Mark it handled now: the point is the second search, not this one.
    firstSearch.catch(() => undefined);
    const secondSearch = webgradientsSource.search("", 1, secondCtx);

    first.abort();
    release();

    const page = await secondSearch;
    expect(page.results.map((result) => result.name)).toEqual(["Warm Flame"]);
    await expect(firstSearch).resolves.toMatchObject({ totalPages: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("clears a failed fetch so the next search retries", async () => {
    let attempts = 0;
    const fetcher = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("offline");
      return new Response(catalogue([WARM_FLAME]), { status: 200 });
    });
    const ctx = context(fetcher as unknown as typeof fetch);

    await expect(webgradientsSource.search("", 1, ctx)).rejects.toThrow(
      "offline",
    );

    const page = await webgradientsSource.search("", 1, ctx);
    expect(page.results.map((result) => result.name)).toEqual(["Warm Flame"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("drops an entry with fewer than two stops", async () => {
    const { fetch } = stubFetch([
      WARM_FLAME,
      {
        name: "One Stop",
        index: "002",
        deg: 45,
        gradient: [{ color: "#112233", pos: 0 }],
      },
      {
        name: "No Stops",
        index: "003",
        deg: 45,
        gradient: [],
      },
      {
        name: "Not A List",
        index: "004",
        deg: 45,
        gradient: "#112233",
      },
    ]);

    const page = await webgradientsSource.search("", 1, context(fetch));
    expect(page.results.map((result) => result.name)).toEqual(["Warm Flame"]);
  });

  it("fails loudly when the catalogue does not answer a list", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ gradients: [] }), { status: 200 }),
    );
    const ctx = context(fetcher as unknown as typeof fetch);

    await expect(webgradientsSource.search("", 1, ctx)).rejects.toThrow(
      "WebGradients",
    );
  });
});
