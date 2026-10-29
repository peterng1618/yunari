import { describe, expect, it, vi } from "vitest";
import { searchSources } from "../search.js";
import type { SourceContext } from "../source.js";
import { unsplashSource } from "./unsplash.js";

const KEY = "test-access-key-1234";
const API = "https://api.unsplash.com/";

interface PhotoOverrides {
  id?: string;
  slug?: string;
  premium?: boolean;
  plus?: boolean;
  smallHost?: string;
  full?: string;
}

function photo(overrides: PhotoOverrides = {}) {
  const id = overrides.id ?? "p1";
  return {
    id,
    slug: overrides.slug ?? `${id}-slug`,
    alt_description: "a cat on a wall",
    premium: overrides.premium ?? false,
    plus: overrides.plus ?? false,
    user: { name: "Jane Doe" },
    links: {
      html: `https://unsplash.com/photos/${id}`,
      download_location: `${API}photos/${id}/download`,
    },
    urls: {
      full: overrides.full ?? `https://images.unsplash.com/${id}-full`,
      regular: `https://${overrides.smallHost ?? "images.unsplash.com"}/${id}-regular`,
      small: `https://${overrides.smallHost ?? "images.unsplash.com"}/${id}-small`,
    },
  };
}

function stubFetch(payload: { results: unknown[]; total_pages: number }) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];

  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });

      if (url.startsWith(`${API}search/photos`)) {
        return new Response(JSON.stringify(payload), { status: 200 });
      }
      if (url === `${API}photos/p1`) {
        return new Response(JSON.stringify(photo()), { status: 200 });
      }
      if (url.endsWith("/download")) {
        return new Response("{}", { status: 200 });
      }
      if (url.startsWith("https://images.unsplash.com/")) {
        return new Response("<jpeg bytes>", { status: 200 });
      }

      return new Response("no route", { status: 404 });
    },
  ) as unknown as typeof fetch;

  return { fetcher, calls };
}

/** The Editorial feed: a bare photo array, with the page count in the Link
 *  header rather than the body. */
function stubFeed(photos: unknown[], link?: string) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];

  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify(photos), {
        status: 200,
        headers:
          link === undefined
            ? { "content-type": "application/json" }
            : { "content-type": "application/json", link },
      });
    },
  ) as unknown as typeof fetch;

  return { fetcher, calls };
}

function context(fetcher: typeof fetch): SourceContext {
  return {
    credential: (id) => (id === "unsplash" ? KEY : undefined),
    signal: new AbortController().signal,
    fetch: fetcher,
  };
}

describe("unsplashSource", () => {
  it("declares an image grid that requires the unsplash credential", () => {
    expect(unsplashSource).toMatchObject({
      id: "unsplash",
      category: "image",
      body: "grid",
      requires: "unsplash",
      configurable: true,
    });
  });

  it("sends the key as a Client-ID header and asks for one page", async () => {
    const { fetcher, calls } = stubFetch({
      results: [photo()],
      total_pages: 1,
    });

    await unsplashSource.search("cat", 1, context(fetcher));

    const search = calls.find((call) => call.url.startsWith(`${API}search/`));
    expect(search?.url).toContain("query=cat");
    expect(search?.url).toContain("per_page=30");
    expect(search?.url).toContain("page=1");
    expect(search?.init?.headers).toEqual({
      Authorization: `Client-ID ${KEY}`,
    });
  });

  it("drops every sign of Unsplash+ content", async () => {
    const { fetcher } = stubFetch({
      results: [
        photo(),
        photo({ id: "premium", premium: true }),
        photo({ id: "plus", plus: true }),
        photo({ id: "hosted", smallHost: "plus.unsplash.com" }),
      ],
      total_pages: 1,
    });

    const page = await unsplashSource.search("cat", 1, context(fetcher));

    expect(page.results.map((entry) => entry.id)).toEqual(["p1"]);
  });

  it("maps a free photo to its preview, photographer and licence", async () => {
    const { fetcher } = stubFetch({ results: [photo()], total_pages: 1 });

    const page = await unsplashSource.search("cat", 1, context(fetcher));

    expect(page.results[0]).toEqual({
      id: "p1",
      name: "a cat on a wall",
      kind: "image",
      preview: "https://images.unsplash.com/p1-small",
      subtitle: "Jane Doe",
      licence: "Unsplash License",
      sourceUrl: "https://unsplash.com/photos/p1",
    });
  });

  it("carries the page count and asks for the page it was given", async () => {
    const { fetcher, calls } = stubFetch({
      results: [photo()],
      total_pages: 3,
    });

    expect(
      await unsplashSource.search("cat", 2, context(fetcher)),
    ).toMatchObject({ totalPages: 3 });
    const asked = calls.find((call) => call.url.startsWith(`${API}search/`));
    expect(asked?.url).toContain("page=2");
    expect(
      await unsplashSource.search("cat", Number.NaN, context(fetcher)),
    ).toMatchObject({ totalPages: 3 });
  });

  it("browses the Editorial feed when the term is empty", async () => {
    // The feed's last page is five, and it says so in the Link header rather
    // than in a JSON field.
    const link =
      '<https://api.unsplash.com/photos?page=1>; rel="first", <https://api.unsplash.com/photos?page=5>; rel="last", <https://api.unsplash.com/photos?page=2>; rel="next"';
    const { fetcher, calls } = stubFeed([photo()], link);

    const page = await unsplashSource.search("", 1, context(fetcher));

    expect(calls[0]?.url).toBe(`${API}photos?page=1&per_page=30`);
    expect(calls[0]?.init?.headers).toEqual({
      Authorization: `Client-ID ${KEY}`,
    });
    expect(page.results.map((entry) => entry.id)).toEqual(["p1"]);
    expect(page.totalPages).toBe(5);
  });

  it("stops at the last page the feed names", async () => {
    // On the last page there is no `rel="next"`, so the feed is finished even
    // though the header still names a page.
    const link = '<https://api.unsplash.com/photos?page=3>; rel="last"';
    const { fetcher } = stubFeed([photo()], link);

    const page = await unsplashSource.search("", 3, context(fetcher));

    expect(page.totalPages).toBe(3);
  });

  it("falls back to a full page when the feed has no Link header", async () => {
    const full = Array.from({ length: 30 }, (_, at) => photo({ id: `p${at}` }));
    const short = full.slice(0, 29);

    expect(
      (await unsplashSource.search("", 1, context(stubFeed(full).fetcher)))
        .totalPages,
    ).toBe(2);
    expect(
      (await unsplashSource.search("", 1, context(stubFeed(short).fetcher)))
        .totalPages,
    ).toBe(1);
  });

  it("drops Unsplash+ content from the feed too", async () => {
    const { fetcher } = stubFeed([
      photo(),
      photo({ id: "premium", premium: true }),
      photo({ id: "hosted", smallHost: "plus.unsplash.com" }),
    ]);

    const page = await unsplashSource.search(" ", 1, context(fetcher));

    expect(page.results.map((entry) => entry.id)).toEqual(["p1"]);
  });

  it("carries the API's own words beside the status", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            errors: ["OAuth error: The access token is invalid"],
          }),
          { status: 401 },
        ),
    ) as unknown as typeof fetch;

    const outcome = await searchSources(
      { query: "cat", enabled: ["unsplash"], pages: {} },
      context(fetcher),
      [unsplashSource],
    );

    const failure = outcome.pages[0]?.failure;
    expect(failure?.reason === "failed" ? failure.message : "").toBe(
      "Unsplash search answered 401: OAuth error: The access token is invalid",
    );
  });

  it("answers a failed page naming the status without the key", async () => {
    const fetcher = vi.fn(
      async () => new Response("unauthorized", { status: 401 }),
    ) as unknown as typeof fetch;

    const outcome = await searchSources(
      { query: "cat", enabled: ["unsplash"], pages: {} },
      context(fetcher),
      [unsplashSource],
    );

    const failure = outcome.pages[0]?.failure;
    expect(failure?.reason).toBe("failed");
    expect(failure?.reason === "failed" ? failure.message : "").toContain(
      "401",
    );
    expect(failure?.reason === "failed" ? failure.message : "").not.toContain(
      KEY,
    );
  });
});

describe("unsplashSource.bytesOf", () => {
  it("triggers the download before fetching the image", async () => {
    const { fetcher, calls } = stubFetch({ results: [], total_pages: 1 });

    const bytes = await unsplashSource.bytesOf("p1", context(fetcher));

    const trigger = calls.findIndex((call) => call.url.endsWith("/download"));
    const image = calls.findIndex((call) =>
      call.url.startsWith("https://images.unsplash.com/"),
    );
    expect(trigger).toBeGreaterThan(-1);
    expect(image).toBeGreaterThan(trigger);
    expect(bytes).toMatchObject({
      contentType: "image/jpeg",
      // The imported name is the photo's full slug, not the id alone.
      filename: "p1-slug.jpg",
    });
    expect(new TextDecoder().decode(bytes?.bytes)).toBe("<jpeg bytes>");
  });

  it("falls back to the id when the API returns no usable slug", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${API}photos/p1`) {
        return new Response(JSON.stringify(photo({ slug: "../escape" })), {
          status: 200,
        });
      }
      if (url.endsWith("/download")) return new Response("{}", { status: 200 });
      if (url.startsWith("https://images.unsplash.com/"))
        return new Response("<jpeg bytes>", { status: 200 });
      return new Response("no route", { status: 404 });
    }) as unknown as typeof fetch;

    const bytes = await unsplashSource.bytesOf("p1", context(fetcher));
    expect(bytes?.filename).toBe("p1.jpg");
  });
});
