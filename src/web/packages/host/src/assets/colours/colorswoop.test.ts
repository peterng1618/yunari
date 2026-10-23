import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetSource, SourceContext } from "../source.js";

const CATALOGUE_URL = "https://colorswoop.com/api/palettes.json";

const SUNSET = {
  id: "sunset-pair",
  name: "Sunset Pair",
  url: "https://colorswoop.com/palettes/sunset-pair",
  colors: ["#112233", "#445566"],
  tags: ["sun", "dusk"],
};

const FOREST = {
  id: "forest-walk",
  name: "Forest Walk",
  url: "https://colorswoop.com/palettes/forest-walk",
  colors: ["#0a0b0c", "#131415", "#161718"],
  tags: ["green"],
};

const CAFE = {
  id: "cafe-blue",
  name: "Café Blue",
  url: "https://colorswoop.com/palettes/cafe-blue",
  colors: ["#010203", "#040506"],
  tags: ["calm"],
};

function catalogue(palettes: readonly unknown[]): string {
  return JSON.stringify({ meta: { count: palettes.length }, palettes });
}

function context(fetcher: typeof fetch): SourceContext {
  return {
    credential: () => undefined,
    signal: new AbortController().signal,
    fetch: fetcher,
  };
}

function stubFetch(palettes: readonly unknown[]) {
  const fetcher = vi.fn(
    async () => new Response(catalogue(palettes), { status: 200 }),
  );
  return { fetcher, fetch: fetcher as unknown as typeof fetch };
}

let colorswoopSource: AssetSource;

beforeEach(async () => {
  vi.resetModules();
  // The catalogue cache is module-level, so each case asks a fresh module.
  ({ colorswoopSource } = await import("./colorswoop.js"));
});

describe("colorswoopSource", () => {
  it("filters by name or tag and pages the filtered list", async () => {
    const { fetch } = stubFetch([SUNSET, FOREST, CAFE]);
    const ctx = context(fetch);

    const page = await colorswoopSource.search("sun", 1, ctx);
    expect(page.results.map((r) => r.name)).toEqual(["Sunset Pair"]);
    expect(page.results[0]?.preset).toEqual({
      kind: "palette",
      colours: ["#112233", "#445566"],
    });
    expect(page.totalPages).toBe(1);
    expect(page.results[0]?.licence).toBe("CC0-1.0");
    expect(page.results[0]?.sourceUrl).toBe(SUNSET.url);

    const byTag = await colorswoopSource.search("DUSK", 1, ctx);
    expect(byTag.results.map((r) => r.name)).toEqual(["Sunset Pair"]);

    const accented = await colorswoopSource.search("cafe", 1, ctx);
    expect(accented.results.map((r) => r.name)).toEqual(["Café Blue"]);
  });

  it("fetches the catalogue once for two searches", async () => {
    const { fetcher, fetch } = stubFetch([SUNSET, FOREST, CAFE]);
    const ctx = context(fetch);

    await colorswoopSource.search("", 1, ctx);
    await colorswoopSource.search("", 2, ctx);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(CATALOGUE_URL, expect.anything());
  });

  it("clears a failed fetch so the next search retries", async () => {
    let attempts = 0;
    const fetcher = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("offline");
      return new Response(catalogue([SUNSET]), { status: 200 });
    });
    const ctx = context(fetcher as unknown as typeof fetch);

    await expect(colorswoopSource.search("", 1, ctx)).rejects.toThrow(
      "offline",
    );

    const page = await colorswoopSource.search("", 1, ctx);
    expect(page.results.map((r) => r.name)).toEqual(["Sunset Pair"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("drops a malformed entry rather than rendering it", async () => {
    const { fetch } = stubFetch([
      SUNSET,
      { ...CAFE, id: "bad-hex", colors: ["#112233", "not-a-colour"] },
      { ...CAFE, id: "bad-short", colors: ["#112233"] },
      { ...CAFE, id: "bad-name", name: 7 },
    ]);

    const page = await colorswoopSource.search("", 1, context(fetch));
    expect(page.results.map((r) => r.id)).toEqual(["sunset-pair"]);
  });
});
