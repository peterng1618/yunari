import { describe, expect, it, vi } from "vitest";
import { FONTAWESOME_VERSION, fontAwesomeSource } from "./fontawesome.js";

const BASE = `https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@${FONTAWESOME_VERSION}/`;
const LICENCE = "CC-BY-4.0 AND OFL-1.1 AND MIT";

/** The shape Font Awesome 6.7's `icon-families.json` actually serves: a
 *  family per style set, never a flat `styles` list. */
const ICONS = {
  house: {
    label: "House",
    svgs: { classic: { solid: {}, regular: {} } },
  },
  "arrow-down": { label: "Arrow Down", svgs: { classic: { solid: {} } } },
  github: { label: "GitHub", svgs: { classic: { brands: {} } } },
};

function stubFetch(overrides: Record<string, Response> = {}) {
  const calls: string[] = [];

  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);

    const override = Object.entries(overrides).find(([suffix]) =>
      url.endsWith(suffix),
    );
    if (override !== undefined) return override[1].clone();

    if (url.endsWith("/metadata/icon-families.json")) {
      return new Response(JSON.stringify(ICONS), { status: 200 });
    }
    if (url.endsWith("/package.json")) {
      return new Response(JSON.stringify({ license: LICENCE }), {
        status: 200,
      });
    }
    if (url.endsWith("/svgs/solid/house.svg")) {
      return new Response("<svg></svg>", { status: 200 });
    }

    return new Response("no route", { status: 404 });
  }) as unknown as typeof fetch;

  return { fetcher, calls };
}

function context(fetcher: typeof fetch) {
  return {
    credential: () => undefined,
    signal: new AbortController().signal,
    fetch: fetcher,
  };
}

describe("fontAwesomeSource", () => {
  it("declares an icon grid that needs no credential", () => {
    expect(fontAwesomeSource).toMatchObject({
      id: "fontawesome-free",
      category: "icon",
      body: "grid",
      requires: undefined,
      configurable: true,
    });
  });

  it("turns metadata into one result per style, credited from the fetched package", async () => {
    const { fetcher } = stubFetch();

    const page = await fontAwesomeSource.search("house", 1, context(fetcher));

    expect(page.results.map((entry) => entry.id)).toEqual([
      "solid:house",
      "regular:house",
    ]);
    expect(page.results[0]).toEqual({
      id: "solid:house",
      name: "house",
      kind: "icon",
      preview: `${BASE}svgs/solid/house.svg`,
      subtitle: "solid",
      licence: LICENCE,
      sourceUrl: "https://fontawesome.com/icons/house?f=solid",
    });
  });

  it("matches a label and ignores case and separators", async () => {
    const { fetcher } = stubFetch();

    const byLabel = await fontAwesomeSource.search(
      "arrow down",
      1,
      context(fetcher),
    );
    expect(byLabel.results.map((entry) => entry.name)).toEqual(["arrow-down"]);

    const byName = await fontAwesomeSource.search("HOUSE", 1, context(fetcher));
    expect(byName.results).toHaveLength(2);
  });

  it("answers one empty page when nothing matches", async () => {
    const { fetcher } = stubFetch();

    const page = await fontAwesomeSource.search(
      "nothing-like-this",
      1,
      context(fetcher),
    );

    expect(page).toEqual({ results: [], totalPages: 1 });
  });

  it("fails with the status when metadata is missing", async () => {
    const { fetcher } = stubFetch({
      "/metadata/icon-families.json": new Response("gone", { status: 404 }),
    });

    await expect(
      fontAwesomeSource.search("house", 1, context(fetcher)),
    ).rejects.toThrow(/404/);
  });

  it("fetches the metadata once for repeated searches", async () => {
    const { fetcher, calls } = stubFetch();

    await fontAwesomeSource.search("house", 1, context(fetcher));
    await fontAwesomeSource.search("github", 1, context(fetcher));

    expect(
      calls.filter((url) => url.endsWith("/metadata/icon-families.json")),
    ).toHaveLength(1);
  });
});

describe("fontAwesomeSource.bytesOf", () => {
  it("asks the CDN for the icon's own SVG", async () => {
    const { fetcher, calls } = stubFetch();

    const bytes = await fontAwesomeSource.bytesOf(
      "solid:house",
      context(fetcher),
    );

    expect(calls).toContain(`${BASE}svgs/solid/house.svg`);
    expect(bytes?.contentType).toBe("image/svg+xml");
    expect(bytes?.filename).toBe("house.svg");
    expect(new TextDecoder().decode(bytes?.bytes)).toBe("<svg></svg>");
  });

  it("answers nothing for an id that names no style and icon", async () => {
    const { fetcher } = stubFetch();

    expect(
      await fontAwesomeSource.bytesOf("house", context(fetcher)),
    ).toBeUndefined();
    expect(
      await fontAwesomeSource.bytesOf(
        "solid:../../etc/passwd",
        context(fetcher),
      ),
    ).toBeUndefined();
  });
});
