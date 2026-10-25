import { describe, expect, it, vi } from "vitest";
import { searchSources } from "../search.js";
import type { SourceContext } from "../source.js";
import { ASSET_SOURCES } from "../sources.js";
import { googleFontSource } from "./google.js";

const REGISTRY = "https://api.fontsource.org/v1/fonts?type=google";
const DETAIL_ROOT = "https://api.fontsource.org/v1/fonts/";
const CDN = "https://cdn.jsdelivr.net/fontsource/fonts/";

/**
 * Fontsource's list endpoint carries every field a cut needs except the
 * package version; that one comes from `/v1/fonts/:id`. The fixtures mirror
 * that split rather than assuming the list is richer than the live API.
 */
interface RegistryRow {
  readonly id: string;
  readonly family: string;
  readonly type: string;
  readonly subsets: readonly string[];
  readonly weights: readonly number[];
  readonly styles: readonly string[];
  readonly defSubset: string;
  readonly category: string;
  readonly license: string;
}

const MANROPE: RegistryRow = {
  id: "manrope",
  family: "Manrope",
  type: "google",
  subsets: ["latin", "latin-ext"],
  weights: [400, 700],
  styles: ["normal"],
  defSubset: "latin",
  category: "sans-serif",
  license: "OFL-1.1",
};

const INTER: RegistryRow = {
  id: "inter",
  family: "Inter",
  type: "google",
  subsets: ["latin"],
  weights: [400],
  styles: ["normal"],
  defSubset: "latin",
  category: "sans-serif",
  license: "OFL-1.1",
};

/** Type "other": a registry row the Google source must not serve. */
const INTER_CLONE: RegistryRow = {
  id: "inter-clone",
  family: "Inter Clone",
  type: "other",
  subsets: ["latin"],
  weights: [400],
  styles: ["normal"],
  defSubset: "latin",
  category: "sans-serif",
  license: "OFL-1.1",
};

const LIST = [MANROPE, INTER, INTER_CLONE];

const DETAILS: Record<string, unknown> = {
  manrope: { ...MANROPE, npmVersion: "5.3.0" },
  inter: { ...INTER, npmVersion: "5.2.1" },
  "inter-clone": { ...INTER_CLONE, npmVersion: "1.0.0" },
};

function jsonOf(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function context(fetcher: typeof fetch): SourceContext {
  return {
    credential: () => undefined,
    signal: new AbortController().signal,
    fetch: fetcher,
  };
}

interface StubOptions {
  readonly list?: Response;
  readonly details?: Record<string, unknown>;
}

function stubFetch(options: StubOptions = {}): {
  readonly fetcher: typeof fetch;
  readonly calls: string[];
} {
  const calls: string[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);

    if (url === REGISTRY) return options.list ?? jsonOf(LIST);

    if (url.startsWith(DETAIL_ROOT)) {
      const id = url.slice(DETAIL_ROOT.length);
      const detail = (options.details ?? DETAILS)[id];
      return detail === undefined
        ? new Response("no such family", { status: 404 })
        : jsonOf(detail);
    }

    if (url.startsWith(CDN)) {
      return new Response(new Uint8Array([0x77, 0x4f, 0x46, 0x32]), {
        status: 200,
      });
    }

    return new Response(`unexpected ${url}`, { status: 500 });
  }) as unknown as typeof fetch;

  return { fetcher, calls };
}

describe("googleFontSource", () => {
  it("declares the Fontsource host and is the source the registry serves", () => {
    expect(googleFontSource).toMatchObject({
      id: "google-fonts",
      category: "font",
      body: "font-picker",
      host: "api.fontsource.org",
      requires: undefined,
      configurable: false,
    });
    expect(ASSET_SOURCES).toContain(googleFontSource);
  });

  it("filters the registry to type google and matches a family name", async () => {
    const { fetcher, calls } = stubFetch();
    const page = await googleFontSource.search("inter", 1, context(fetcher));

    // "Inter Clone" matches the term but is not a Google family.
    expect(page.results.map((result) => result.name)).toEqual(["Inter"]);
    expect(calls[0]).toBe(REGISTRY);
    expect(calls).not.toContain(`${DETAIL_ROOT}inter-clone`);
    expect(page.results[0]?.font?.cuts).toHaveLength(1);
  });

  it("returns one cut per published weight and subset, pinned to npmVersion", async () => {
    const { fetcher } = stubFetch();
    const page = await googleFontSource.search("manrope", 1, context(fetcher));

    const family = page.results[0];
    expect(family?.name).toBe("Manrope");
    expect(family?.font?.cuts).toHaveLength(4);

    for (const cut of family?.font?.cuts ?? []) {
      expect(cut.id).toMatch(/^cut:manrope@5\.3\.0\//);
      expect(cut.source).toBe("google-fonts");
      expect(cut.format).toBe("woff2");
      expect(cut.licence).toBe("OFL-1.1");
      expect(cut.previewUrl).toBe(
        `${CDN}manrope@5.3.0/${cut.subset}-${cut.weight}-normal.woff2`,
      );
      expect(cut.sourceUrl).toBe(cut.previewUrl);
      expect(cut.previewUrl).not.toContain("latest");
    }
  });

  it("answers a failed registry fetch as a failed page, not a throw", async () => {
    const { fetcher } = stubFetch({
      list: new Response("registry down", { status: 503 }),
    });

    const outcome = await searchSources(
      {
        query: "manrope",
        enabled: ["google-fonts"],
        pages: {},
        body: "font-picker",
      },
      context(fetcher),
      [googleFontSource],
    );

    expect(outcome.pages).toHaveLength(1);
    const failure = outcome.pages[0]?.failure;
    if (failure?.reason !== "failed") throw new Error("expected a failed page");
    expect(failure.message).toMatch(/503/);
    expect(outcome.pages[0]?.results).toEqual([]);
  });

  it("serves a woff2 for a cut through the injected fetch", async () => {
    const { fetcher, calls } = stubFetch();
    const page = await googleFontSource.search("manrope", 1, context(fetcher));
    const cut = page.results[0]?.font?.cuts.find(
      (entry) => entry.subset === "latin" && entry.weight === 400,
    );
    if (cut === undefined) throw new Error("no latin 400 cut");

    const bytes = await googleFontSource.bytesOf(cut.id, context(fetcher));

    expect(calls).toContain(cut.previewUrl);
    expect(bytes?.contentType).toBe("font/woff2");
    expect(bytes?.filename).toBe("manrope-5.3.0-latin-400-normal.woff2");
    expect(bytes?.bytes).toEqual(new Uint8Array([0x77, 0x4f, 0x46, 0x32]));
  });

  it("refuses an id that is not a pinned cut", async () => {
    const { fetcher, calls } = stubFetch();

    expect(
      await googleFontSource.bytesOf(
        "cut:https://example.test/x",
        context(fetcher),
      ),
    ).toBeUndefined();
    expect(await googleFontSource.bytesOf("manrope", context(fetcher))).toBe(
      undefined,
    );
    expect(calls).toHaveLength(0);
  });

  it("pages matches so one open does not fetch every family", async () => {
    const rows: RegistryRow[] = Array.from({ length: 30 }, (_, index) => ({
      id: `family-${index}`,
      family: `Family ${index}`,
      type: "google",
      subsets: ["latin"],
      weights: [400],
      styles: ["normal"],
      defSubset: "latin",
      category: "sans-serif",
      license: "OFL-1.1",
    }));
    const details: Record<string, unknown> = Object.fromEntries(
      rows.map((row) => [row.id, { ...row, npmVersion: "1.0.0" }]),
    );
    const { fetcher, calls } = stubFetch({
      list: jsonOf(rows),
      details,
    });

    const page = await googleFontSource.search("", 2, context(fetcher));

    expect(page.totalPages).toBe(2);
    expect(page.results).toHaveLength(6);
    expect(page.results[0]?.name).toBe("Family 24");
    expect(
      calls.filter((url) => url.startsWith(`${DETAIL_ROOT}family-`)),
    ).toHaveLength(6);
  });
});
