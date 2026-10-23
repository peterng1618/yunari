import { describe, expect, it, vi } from "vitest";
import type { SourceContext } from "../source.js";
import { colorhuntSource } from "./colorhunt.js";

const FEED_URL = "https://colorhunt.co/php/feed.php";

const SUNSET = {
  code: "15370d728e6de5cd82fff2b4",
  likes: "50",
  date: "15 hours",
};

function context(fetcher: typeof fetch): SourceContext {
  return {
    credential: () => undefined,
    signal: new AbortController().signal,
    fetch: fetcher,
  };
}

function stubFetch(entries: unknown) {
  return vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(entries), { status: 200 }),
  );
}

function codes(count: number): readonly unknown[] {
  return Array.from({ length: count }, (_, index) => ({
    code: index.toString(16).padStart(24, "0"),
  }));
}

describe("colorhuntSource", () => {
  it("posts the page as a feed step and the query as a tag", async () => {
    const fetch = stubFetch([SUNSET]);
    const ctx = context(fetch as unknown as typeof fetch);

    await colorhuntSource.search("sunset", 2, ctx);

    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(url).toBe(FEED_URL);
    expect(init?.method).toBe("POST");
    expect(String(init?.body)).toContain("step=1");
    expect(String(init?.body)).toContain("tags=sunset");
    expect(String(init?.body)).toContain("sort=new");
    expect(String(init?.body)).toContain("timeframe=");
    expect(init?.headers).toMatchObject({
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    });

    const page = await colorhuntSource.search("sunset", 2, ctx);
    expect(page.results[0]?.subtitle).toBe("50 likes");
  });

  it("splits a 12-hex code into four colours", async () => {
    const fetch = stubFetch([{ code: "aabbccddeeff112233445566" }]);
    const ctx = context(fetch as unknown as typeof fetch);

    const page = await colorhuntSource.search("", 1, ctx);

    expect(page.results[0]?.preset).toEqual({
      kind: "palette",
      colours: ["#aabbcc", "#ddeeff", "#112233", "#445566"],
    });
  });

  it("drops a code that is not 24 hex characters", async () => {
    const fetch = stubFetch([
      { code: "aabbcc" },
      { code: "aabbccddeeff11223344556g" },
      { code: 7 },
      SUNSET,
    ]);
    const ctx = context(fetch as unknown as typeof fetch);

    const page = await colorhuntSource.search("", 1, ctx);

    expect(page.results.map((result) => result.id)).toEqual([SUNSET.code]);
  });

  it("reports the last page from a short page and leaves a full page unknown", async () => {
    const short = stubFetch(codes(2));
    const shortPage = await colorhuntSource.search(
      "",
      3,
      context(short as unknown as typeof fetch),
    );
    expect(shortPage.totalPages).toBe(3);

    const full = stubFetch(codes(40));
    const fullPage = await colorhuntSource.search(
      "",
      1,
      context(full as unknown as typeof fetch),
    );
    expect(fullPage.totalPages).toBeUndefined();
  });

  it("carries an unknown licence and the palette's own page", async () => {
    const fetch = stubFetch([SUNSET]);
    const ctx = context(fetch as unknown as typeof fetch);

    const page = await colorhuntSource.search("", 1, ctx);

    expect(page.results[0]?.licence).toBe("unknown");
    expect(page.results[0]?.sourceUrl).toBe(
      `https://colorhunt.co/palette/${SUNSET.code}`,
    );
    expect(page.results[0]?.name).toBe("Color Hunt 15370D");
  });

  it("sends a query containing a space as the form value", async () => {
    const fetch = stubFetch([SUNSET]);
    const ctx = context(fetch as unknown as typeof fetch);

    await colorhuntSource.search("warm sunset", 1, ctx);

    const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(init?.body)).toContain("tags=warm+sunset");
  });

  it("fails loudly when the feed does not answer a list", async () => {
    const fetch = stubFetch({ palettes: [] });
    const ctx = context(fetch as unknown as typeof fetch);

    await expect(colorhuntSource.search("", 1, ctx)).rejects.toThrow(
      "Color Hunt feed",
    );
  });
});
