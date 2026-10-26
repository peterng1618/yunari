import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { followPublished, reResolveUrl } from "./publish-follower.js";

const answer = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

/** The page a host-served display is on, which is what the follower polls from:
 *  the host resolved this theme itself. */
const MAP_PAGE =
  "http://127.0.0.1:5227/?display=left-screen&theme=studio&data=live&theme-source=map";

const settle = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe("followPublished", () => {
  it("does not reload while the revision sits still", async () => {
    const reload = vi.fn();
    const stop = followPublished(
      {
        pageUrl: MAP_PAGE,
        fetch: answer({ id: "living-room", revision: 4 }),
      },
      reload,
      { intervalMs: 5 },
    );

    await settle(40);
    stop();
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads once the revision moves", async () => {
    let revision = 4;
    const reload = vi.fn();
    const stop = followPublished(
      {
        pageUrl: MAP_PAGE,
        fetch: vi.fn(
          async () =>
            new Response(JSON.stringify({ id: "living-room", revision })),
        ),
      },
      reload,
      { intervalMs: 5 },
    );

    await settle(20);
    revision = 5;
    await settle(40);
    stop();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("stops, and says so, when the host refuses the session", async () => {
    const reload = vi.fn();
    const refused = vi.fn();
    const stop = followPublished(
      { pageUrl: MAP_PAGE, fetch: answer({ error: "not paired" }, 403) },
      reload,
      { intervalMs: 5, onRefused: refused },
    );

    await settle(40);
    const calls = refused.mock.calls.length;
    await settle(40);
    stop();

    expect(calls).toBeGreaterThan(0);
    // Stopped: a refusal is reported once, not polled forever.
    expect(refused.mock.calls.length).toBe(calls);
    expect(reload).not.toHaveBeenCalled();
  });

  it("calls onThemeChange when the host's answer moves", async () => {
    let theme = "studio";
    const reload = vi.fn();
    const onThemeChange = vi.fn();
    const stop = followPublished(
      {
        pageUrl: MAP_PAGE,
        fetch: vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                id: null,
                revision: 0,
                display: { id: "left-screen", theme },
              }),
            ),
        ),
      },
      reload,
      { intervalMs: 5, onThemeChange },
    );

    await settle(20);
    // The first answer is the baseline: a page that has just loaded is already
    // showing what the host resolved for it.
    expect(onThemeChange).not.toHaveBeenCalled();

    theme = "living-room";
    await settle(40);
    stop();

    expect(onThemeChange).toHaveBeenCalledTimes(1);
    expect(onThemeChange).toHaveBeenCalledWith("living-room");
    // The callback *is* the reload: a caller that answered it has already
    // navigated, and reloading the URL that navigation just left would undo it.
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads itself when the caller has no theme callback", async () => {
    let theme = "studio";
    const reload = vi.fn();
    const stop = followPublished(
      {
        pageUrl: MAP_PAGE,
        fetch: vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                id: null,
                revision: 0,
                display: { id: "left-screen", theme },
              }),
            ),
        ),
      },
      reload,
      { intervalMs: 5 },
    );

    await settle(20);
    theme = "living-room";
    await settle(40);
    stop();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not call onThemeChange when the answer is unchanged", async () => {
    const reload = vi.fn();
    const onThemeChange = vi.fn();
    const stop = followPublished(
      {
        pageUrl: MAP_PAGE,
        fetch: answer({
          id: null,
          revision: 0,
          display: { id: "left-screen", theme: "studio" },
        }),
      },
      reload,
      { intervalMs: 5, onThemeChange },
    );

    await settle(40);
    stop();

    expect(onThemeChange).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("follows the map only for a page the host resolved itself", async () => {
    /** One follower, against a host whose answer moves, answering what it did
     *  and the poll it asked with. */
    async function follow(pageUrl: string): Promise<{
      readonly themes: readonly (string | null)[];
      readonly reloads: number;
      readonly asked: string | undefined;
    }> {
      let theme = "studio";
      const reload = vi.fn();
      const onThemeChange = vi.fn();
      const fetch = vi.fn(
        async (_input: RequestInfo | URL) =>
          new Response(
            JSON.stringify({
              id: null,
              revision: 0,
              display: { id: "left-screen", theme },
            }),
          ),
      );
      const stop = followPublished({ pageUrl, fetch }, reload, {
        intervalMs: 5,
        onThemeChange,
      });

      await settle(20);
      theme = "living-room";
      await settle(40);
      stop();

      const asked = fetch.mock.calls[0]?.[0];

      return {
        themes: onThemeChange.mock.calls.map((call) => call[0]),
        reloads: reload.mock.calls.length,
        asked: typeof asked === "string" ? asked : asked?.toString(),
      };
    }

    const map = await follow(MAP_PAGE);
    expect(map.themes).toEqual(["living-room"]);
    expect(map.reloads).toBe(0);
    // The display names itself — that is the sighting its window makes — and
    // names no theme: a theme the host resolved itself is answered by the map,
    // and a page that echoed its own back would be answered `null` for ever.
    expect(map.asked).toBe(
      "/api/published?display=left-screen&theme-source=map",
    );

    const link = await follow(
      "http://127.0.0.1:5227/?theme=studio&data=live&theme-source=link",
    );
    expect(link.themes).toEqual([]);
    expect(link.reloads).toBe(0);
    // A link is the person's own instruction for that page, so it says so.
    expect(link.asked).toBe("/api/published?theme-source=link&theme=studio");

    const published = await follow(
      "http://127.0.0.1:5227/?theme=studio&data=live&theme-source=published",
    );
    expect(published.themes).toEqual([]);
    expect(published.reloads).toBe(0);
    expect(published.asked).toBe("/api/published?theme-source=published");
  });
});

describe("followPublished's rate report", () => {
  it("reports a rate it can honour, and ignores one it cannot", async () => {
    // The narrowing lives where the value is read, because it arrives as JSON
    // and `setRate` stores the number raw and divides by it: a 0 makes the
    // cadence comparison `< Infinity` — true for ever — and the display stops
    // refreshing with nothing logged (R64). Refused rather than coerced.
    const onRateChange = vi.fn();
    const stop = followPublished(
      {
        pageUrl: MAP_PAGE,
        fetch: answer({ revision: 1, display: { chartFps: 30 } }),
      },
      vi.fn(),
      { intervalMs: 5, onRateChange },
    );

    await settle(20);
    stop();
    expect(onRateChange).toHaveBeenLastCalledWith(30);

    for (const bad of [0, 7, "30", null, undefined]) {
      const next = vi.fn();
      const s = followPublished(
        {
          pageUrl: MAP_PAGE,
          fetch: answer({ revision: 1, display: { chartFps: bad } }),
        },
        vi.fn(),
        { intervalMs: 5, onRateChange: next },
      );
      await settle(20);
      s();
      expect(
        next,
        `chartFps ${String(bad)} is not a rate`,
      ).not.toHaveBeenCalled();
    }
  });

  it("reports a later rate without waiting for the revision to move", async () => {
    // The loop is re-rated in place, so the follower has to carry a rate that
    // moves on its own — a display whose person changed it is not a new publish.
    let rate: unknown = 1;
    const onRateChange = vi.fn();
    const stop = followPublished(
      {
        pageUrl: MAP_PAGE,
        fetch: vi.fn(
          async () =>
            new Response(
              JSON.stringify({ revision: 0, display: { chartFps: rate } }),
            ),
        ),
      },
      vi.fn(),
      { intervalMs: 5, onRateChange },
    );

    await settle(20);
    rate = 30;
    await settle(40);
    stop();

    expect(onRateChange).toHaveBeenLastCalledWith(30);
    expect(onRateChange).toHaveBeenCalledWith(1);
  });
});

describe("followPublished's presentation report", () => {
  /** One follower whose host answers the same body every tick. */
  const sessionReturning = (body: unknown) => ({
    pageUrl: MAP_PAGE,
    fetch: answer(body),
  });

  it("reports a shape and rotation from the poll", async () => {
    const seen: unknown[] = [];
    const stop = followPublished(
      sessionReturning({ display: { shape: "circle", rotation: 45 } }),
      () => {},
      {
        intervalMs: 5,
        onPresentationChange: (next) => seen.push(next),
      },
    );
    await settle(20);
    stop();
    expect(seen).toEqual([{ shape: "circle", rotation: 45 }]);
  });

  it("refuses a rect rotation that is not a quarter turn", async () => {
    const seen: unknown[] = [];
    const stop = followPublished(
      sessionReturning({ display: { shape: "rect", rotation: 45 } }),
      () => {},
      {
        intervalMs: 5,
        onPresentationChange: (next) => seen.push(next),
      },
    );
    await settle(20);
    stop();
    expect(seen).toEqual([]);
  });

  it("reports only when the presentation moves", async () => {
    const seen: unknown[] = [];
    const stop = followPublished(
      sessionReturning({ display: { shape: "circle", rotation: 45 } }),
      () => {},
      {
        intervalMs: 5,
        onPresentationChange: (next) => seen.push(next),
      },
    );
    await settle(20);
    await settle(20);
    stop();
    expect(seen).toHaveLength(1);
  });
});

describe("followPublished's unreachable report", () => {
  it("reports an unreachable host rather than swallowing it", async () => {
    // Today this error is discarded (`publish-follower.ts`'s `catch`), which is
    // why the ladder had no way to run at all.
    const onUnreachable = vi.fn();
    const stop = followPublished(
      {
        pageUrl: MAP_PAGE,
        fetch: vi.fn(async () => Promise.reject(new Error("down"))),
      },
      vi.fn(),
      { intervalMs: 5, onUnreachable },
    );

    await settle(40);
    stop();

    expect(onUnreachable).toHaveBeenCalled();
  });

  it("reports every unreachable tick, and leaves the pacing to its caller", async () => {
    // A latch here was the first shape ruled and it strands the display: the one
    // sweep misses while the host is still booting, no tick can succeed while
    // the host is at its old address, so the latch never clears and nothing is
    // tried again (R72). The follower reports a fact; the player owns the
    // cooldown.
    const onUnreachable = vi.fn();
    const stop = followPublished(
      {
        pageUrl: MAP_PAGE,
        fetch: vi.fn(async () => Promise.reject(new Error("down"))),
      },
      vi.fn(),
      { intervalMs: 5, onUnreachable },
    );

    await settle(40);
    stop();

    expect(onUnreachable.mock.calls.length).toBeGreaterThan(1);
  });
});

describe("followPublished's poll cadence", () => {
  // Fake timers, and the fetch answer handed over by the test: the question is
  // the *ordering* of the wake against the settle, which a real timeout races.
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** A fetch the test answers one request at a time. */
  function controlled() {
    const pending: ((response: Response) => void)[] = [];

    return {
      fetch: vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            pending.push(resolve);
          }),
      ),
      answer: (response: Response): void => {
        const resolve = pending.shift();
        if (!resolve) throw new Error("no request in flight to answer");
        resolve(response);
      },
    };
  }

  it("keeps one request in flight and re-arms only once it settles", async () => {
    const { fetch, answer } = controlled();
    const stop = followPublished({ pageUrl: MAP_PAGE, fetch }, vi.fn(), {
      intervalMs: 2_000,
    });

    expect(fetch).toHaveBeenCalledTimes(1);

    // Two intervals pass while the first request is still out. A fixed
    // interval would have stacked two more requests on top of it.
    await vi.advanceTimersByTimeAsync(4_000);
    expect(fetch).toHaveBeenCalledTimes(1);

    answer(new Response(JSON.stringify({ revision: 1 })));
    await vi.advanceTimersByTimeAsync(0);
    // Settling is not itself a wake: the next poll waits a full interval, not
    // merely "by the end of one" — one millisecond short is still one request.
    expect(fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);

    stop();
  });

  it.each([403, 404])(
    "stops polling after the host answers %i",
    async (status) => {
      const refused = vi.fn();
      const fetch = vi.fn(async () => new Response("{}", { status }));
      const stop = followPublished({ pageUrl: MAP_PAGE, fetch }, vi.fn(), {
        intervalMs: 2_000,
        onRefused: refused,
      });

      // The refusal is answered before any clock passes, which is the only
      // moment a stray wake is visible: it fires later, early-returns at the
      // `stopped` check, and leaves the fetch count unchanged.
      await vi.advanceTimersByTimeAsync(0);

      expect(refused).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount(), "a refused follower arms nothing").toBe(0);

      await vi.advanceTimersByTimeAsync(10_000);

      expect(refused).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(1);

      stop();
    },
  );

  it("stops polling when its returned stop function is called", async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ revision: 1 })),
    );
    const stop = followPublished({ pageUrl: MAP_PAGE, fetch }, vi.fn(), {
      intervalMs: 2_000,
    });

    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetch).toHaveBeenCalledTimes(2);

    stop();
    // The armed wake is cleared, not merely ignored: a pending timer is the
    // difference the fetch count cannot see.
    expect(vi.getTimerCount(), "the stop clears the poll").toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not re-arm a request that settles after the stop", async () => {
    const { fetch, answer } = controlled();
    const stop = followPublished({ pageUrl: MAP_PAGE, fetch }, vi.fn(), {
      intervalMs: 2_000,
    });

    stop();
    answer(new Response(JSON.stringify({ revision: 1 })));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount(), "a stopped follower arms nothing").toBe(0);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("reResolveUrl", () => {
  const page = "http://127.0.0.1:5227/";

  it("re-resolves on a map page and leaves a link page's id alone", () => {
    // `data` is what makes the host skip its resolution, so it always goes: a
    // reload that keeps it re-serves the theme id already in the URL, and a
    // reassignment changes exactly that id.
    expect(
      reResolveUrl(
        `${page}?display=left-screen&theme=studio&data=live&theme-source=map`,
      ),
    ).toBe(`${page}?display=left-screen&theme-source=map`);

    // The id a map page holds is the host's own answer, so it is the one that
    // has to go; a link page's id is the person's instruction and stays.
    expect(
      reResolveUrl(`${page}?theme=studio&data=live&theme-source=link`),
    ).toBe(`${page}?theme=studio&theme-source=link`);

    // A published page keeps its id, exactly as it behaves today.
    expect(
      reResolveUrl(`${page}?theme=studio&data=live&theme-source=published`),
    ).toBe(`${page}?theme=studio&theme-source=published`);
  });

  it("keeps the display the page names, so the sighting survives the reload", () => {
    expect(
      reResolveUrl(
        `${page}?display=left-screen&session=abc123&theme=studio&data=live&theme-source=map`,
      ),
    ).toBe(`${page}?display=left-screen&session=abc123&theme-source=map`);
  });
});
