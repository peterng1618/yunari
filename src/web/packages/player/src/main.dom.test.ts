// @vitest-environment jsdom
// @vitest-environment-options {"url": "http://192.168.1.10:5227/"}
// The re-find cases below need this LAN origin: `sweepAddresses("localhost")` is
// empty, so on the default jsdom origin there is no sweep to assert and both
// cases go red on their own counts. Measured, not reasoned: dropping this line
// fails them (`expected +0 to be 253`), and the credential case's own
// `swept.length > 0` guard is what turns the missing origin into red rather
// than into a silent green.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAIRING_STORAGE_KEY, readStoredPairing } from "./host-refind.js";

/**
 * `vg-190`: a rejection arriving after the scene mounted calls
 * `showLoadFailure`, which replaces the whole document and discards a display
 * that was already drawn. Ruled 2026-10-14: the replacement is intended — a
 * display that says it is broken beats one showing stale art — so what this
 * case pins is the behaviour, not a fix to it.
 *
 * The row stayed open on its own measurement debt: of the three calls
 * `startHostedTheme` makes after `mountFabricScene`, which can actually reject
 * was unmeasured. Read, they are:
 *
 * - `loadFontAssets` cannot. `font-assets.ts` routes every failure — no
 *   `FontFace` API, missing bytes, missing metadata, a face that will not load —
 *   to `options.onError(...)` and carries on, which is what `reportFontError`'s
 *   own comment says is deliberate.
 * - `refresh` cannot. It is `(): void` and synchronous, so it holds no promise
 *   to reject.
 * - `reviveThemeEnvelope` can, and it is the only one.
 *   `assertFabricThemeEnvelopeCompatible` runs before the first `await` inside
 *   it, so a theme pinned to another Fabric runtime throws inside an `async`
 *   function — a rejected promise, which the `catch` around the display's whole
 *   lifetime turns into `showLoadFailure`.
 *
 * This case drives that path through the real `main.ts`, which has no other
 * test. The refusal is `assertFabricThemeEnvelopeCompatible`'s own: the
 * envelope is served, validated and accepted, and only the mounted scene's
 * revival refuses it. Stubbing `reviveThemeEnvelope` to reject would prove a
 * `catch` is wired and nothing about which call can fail.
 */

const THEME_ID = "late-rejection";

/** The document `index.html` ships, in its own order: the top band, the artboard
 *  host, then the bottom band. All three, so "the body was replaced" is a claim
 *  about the shipped document rather than about the elements built here. */
function skeleton(): HTMLElement {
  document.body.replaceChildren();
  const top = document.createElement("div");
  top.id = "yunari-chrome-top";
  top.dataset["yunariChrome"] = "top";
  const host = document.createElement("div");
  host.id = "artboard";
  Object.defineProperty(host, "clientWidth", { value: 412 });
  Object.defineProperty(host, "clientHeight", { value: 839 });
  const bottom = document.createElement("div");
  bottom.id = "yunari-chrome-bottom";
  bottom.dataset["yunariChrome"] = "bottom";
  document.body.append(top, host, bottom);
  return host;
}

/**
 * Valid to `validateFabricThemeEnvelope` — which pins only the shape of
 * `fabricVersion`, never the runtime — so the host serves it and the player
 * accepts it. Only the mount's own compatibility check refuses it.
 */
function servedEnvelope(): unknown {
  return {
    schemaVersion: 2,
    fabricVersion: "0.0.1",
    id: "living-room",
    artboard: { width: 1920, height: 1080 },
    metadata: { themeLanguage: "en" },
    scene: { version: "0.0.1", objects: [] },
  };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** The readings stream. A stub transport, so no socket is opened; the path
 *  under test is the document load, not the live source. */
class SilentEventSource {
  addEventListener(): void {}
  close(): void {}
}

/**
 * The player's re-find, which is where the retry and the probe both live (R72).
 *
 * The follower reports every failed tick — a fact, not a policy — so four failed
 * ticks inside one cooldown must be one sweep rather than four, and a failed
 * sweep must be allowed another once the cooldown passes. Measured both ways:
 * with the cooldown removed this case sees 1265 requests (one sweep per tick,
 * plus the one the load started with), and with the retry removed it never sees
 * the second 253. Timers are faked because a cooldown of real seconds is a test
 * nobody would wait for.
 *
 * The credential case shares this harness, and has to live here rather than in
 * `host-refind.test.ts`: that file can only catch a mutation *inside* the
 * ladder, while the real risk is `main.ts` building its probe from
 * `session.fetch`/`withToken`, which the ladder's own tests never see (R63).
 *
 * It runs before the cases below because a jsdom file shares one window: a
 * display another case mounted is still holding real timers, and this case's
 * clock is what is under test.
 */
describe("the player's re-find", () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
    // The cases below drive `main.ts` through their own import, and a module
    // this case already evaluated would not run its start sequence again.
    vi.resetModules();
  });

  /** Microtasks only: the mount, the poll and the sweep are promises, and the
   *  fake clock is advanced explicitly where a timer is the point. */
  async function flush(): Promise<void> {
    for (let turn = 0; turn < 400; turn += 1) {
      await Promise.resolve();
    }
  }

  /** One request the player made, and the `init` it made it with: a credential
   *  rides in a header, so a case about the credential needs both halves. */
  interface Asked {
    readonly url: string;
    readonly init: RequestInit | undefined;
  }

  /** A request to another *address* on this /24, which is what the sweep is. The
   *  ladder's two known candidates are this page's own address and the host's
   *  name, so neither is counted, and one ladder run makes exactly 253 of these
   *  — the number `sweepAddresses` gives. The page is at a LAN address rather
   *  than a name because a name has no /24 to sweep, and the display this task
   *  is for is the one whose URL is one. */
  function isSweptAddress(url: string): boolean {
    const target = new URL(url, window.location.href);
    return (
      target.origin !== window.location.origin &&
      /^\d+\.\d+\.\d+\.\d+$/.test(target.hostname)
    );
  }

  /** Mounts a paired display whose host has moved: every poll fails, so every
   *  tick reports it and the ladder runs. */
  async function mountWithTheHostGone(): Promise<{ readonly asked: Asked[] }> {
    // The display this case mounts gets no frames: a minute of fake time is
    // ~1900 repaints at the chart loop's rate, and every one of them is work
    // this case is not about. `window`'s own pair, because the chart loop binds
    // those rather than the globals `vi.stubGlobal` replaces — and stubbing the
    // globals alone left the case at 17 s of a 20 s budget.
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(0);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(
      () => undefined,
    );
    vi.useFakeTimers();
    skeleton();
    history.replaceState(
      {},
      "",
      "/?theme=living-room&display=d1&theme-source=map&session=paired-token",
    );
    vi.stubGlobal("EventSource", SilentEventSource);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );

    const asked: Asked[] = [];

    Object.defineProperty(window, "fetch", {
      configurable: true,
      writable: true,
      value: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        asked.push({ url, init });

        if (url === "/api/host") {
          return json({ id: "h1", name: "study-pc", port: 5227 });
        }
        // The host has moved: every poll fails, so every tick reports it.
        if (url.startsWith("/api/published")) {
          throw new Error("down");
        }
        if (url.endsWith("/document")) return json(mountedEnvelope());
        if (url === "/api/themes") return json({ themes: [] });
        // Any swept address: a host that is not this display's.
        return json({});
      }),
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await import("./main.js");
    await flush();

    return { asked };
  }

  /** One failed tick, and the microtasks its report sets off: the sweep is 253
   *  promises deep, so the clock cannot be advanced in one block without
   *  starving it — and a sweep still in flight is a sweep the next tick is
   *  meant to leave alone. */
  async function failedTick(): Promise<void> {
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();
  }

  it("sweeps once per cooldown, not once per failed tick", async () => {
    const { asked } = await mountWithTheHostGone();
    const swept = (): number =>
      asked.filter(({ url }) => isSweptAddress(url)).length;

    expect(swept()).toBe(253);

    // Four failed ticks inside the cooldown are one sweep, not four.
    for (let tick = 0; tick < 4; tick += 1) {
      await failedTick();
    }

    expect(swept()).toBe(253);

    // Past the cooldown a failed tick is allowed another, which is the retry a
    // latch in the follower could never give this display. One advance, because
    // no sweep is in flight here: every tick in the window is blocked by the
    // cooldown until the first one that is not, and that one sweeps.
    await vi.advanceTimersByTimeAsync(62_000);
    await flush();

    expect(swept()).toBe(506);
  });

  it("sends no credential to a swept address", async () => {
    const { asked } = await mountWithTheHostGone();

    // The sweep has to have happened, or the case below is vacuous. It has by
    // the time the mount returns: the follower polls once on start, that tick
    // fails, and `onUnreachable` runs the ladder.
    const swept = asked.filter(({ url }) => isSweptAddress(url));

    expect(swept.length).toBeGreaterThan(0);

    // `/api/host` is unauthenticated and CORS `*`, so the probe needs no
    // credential — and a probe built from `session.fetch`/`withToken` would
    // offer this display's token to every address that answers, which is the
    // opposite of what the stored `hostId` is for (R63).
    const offenders = swept
      .filter(
        ({ url, init }) =>
          url.includes("session") ||
          new Headers(init?.headers).has("x-yunari-session"),
      )
      .map(({ url }) => url);

    expect(offenders).toEqual([]);
  });
});

/**
 * The rate this display's own charts repaint at, driven through the real
 * `main.ts`.
 *
 * The host answers it on `/api/published`, which the follower already polls, so
 * the loop is re-rated in place rather than restarted. What is observed is the
 * loop's own repaint cadence, not the argument it was started with: the driver
 * `startChartRefresh` defaults to is `window.requestAnimationFrame`, so the spy
 * below *is* the loop's clock (R75).
 *
 * It runs before the cases that follow because a jsdom file shares one window
 * and each of those imports `main.ts` for the first time — an already-evaluated
 * module would not run its start sequence again (R75).
 */
describe("the rate the display repaints at", () => {
  let chartFps: unknown = 1;
  let pending = new Map<number, FrameRequestCallback>();
  let nextHandle = 0;
  let clock = 0;

  beforeEach(() => {
    vi.resetModules();
    chartFps = 1;
    pending = new Map();
    nextHandle = 0;
    clock = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  /** One frame of the loop's own clock. The clock is monotonic across calls
   *  because the loop's own `lastRefreshMs` is: rewinding it would make every
   *  frame look too early to repaint. */
  function driveFrame(): void {
    clock += 1;
    const due = [...pending.values()];
    pending.clear();
    for (const callback of due) callback(clock);
  }

  /** The gap, on that clock, between the loop's next two repaints. It repaints
   *  on the first frame at or past `1000 / rate`, so the gap is that interval
   *  rounded up to a frame. */
  function refreshCadenceMs(repaints: () => number): number {
    let seen = repaints();
    let first: number | undefined;

    for (let frame = 0; frame < 5_000; frame += 1) {
      driveFrame();
      const total = repaints();
      if (total === seen) continue;
      seen = total;
      if (first === undefined) first = clock;
      else return clock - first;
    }

    throw new Error("the loop repainted fewer than twice in 5000 frames");
  }

  /** How many frame loops the page keeps alive: one re-armed callback per frame
   *  is one loop, so a `setRate` that restarted the loop instead of re-setting
   *  it would leave two. */
  function refreshLoopsStarted(): number {
    driveFrame();
    return pending.size;
  }

  /** Mounts the player and hands back a count of the canvas's repaints. */
  async function mountAt(
    search: string,
  ): Promise<{ readonly repaints: () => number }> {
    skeleton();
    history.replaceState({}, "", `/${search}`);
    vi.stubGlobal("EventSource", SilentEventSource);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    // `window`'s own pair, because the chart loop binds those rather than the
    // globals `vi.stubGlobal` replaces — and stubbing the globals alone left a
    // case at 17 s of a 20 s budget (R75).
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      nextHandle += 1;
      pending.set(nextHandle, callback);
      return nextHandle;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((handle) => {
      pending.delete(handle);
    });
    Object.defineProperty(window, "fetch", {
      configurable: true,
      writable: true,
      value: vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/published")) {
          // A revision and a theme that never move, so the rate is the only
          // thing the host answers differently between one poll and the next.
          return json({
            id: null,
            revision: 0,
            display: { id: "d1", theme: "living-room", chartFps },
          });
        }
        if (url.endsWith("/document")) return json(mountedEnvelope());
        return json({});
      }),
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await import("./main.js");
    await vi.waitFor(() => {
      expect(
        document.querySelector("[data-yunari-load-failure]"),
        "the display mounted",
      ).toBeNull();
      expect(
        document.querySelector("[data-yunari-controls]"),
        "and reached its chrome",
      ).not.toBeNull();
    });

    const diagnostics = window as unknown as {
      readonly yunari: {
        readonly handle: {
          readonly canvas: { requestRenderAll: () => void };
        };
      };
    };
    const render = vi.spyOn(
      diagnostics.yunari.handle.canvas,
      "requestRenderAll",
    );

    return { repaints: () => render.mock.calls.length };
  }

  it("runs at the rate the host answered, not the 30 it used to hardcode", async () => {
    const { repaints } = await mountAt(
      "?theme=living-room&display=d1&theme-source=map&session=paired-token",
    );

    await vi.waitFor(() => expect(refreshCadenceMs(repaints)).toBe(1_000));
  });

  it("follows a rate change without a reload and without a second loop", async () => {
    const { repaints } = await mountAt(
      "?theme=living-room&display=d1&theme-source=map&session=paired-token",
    );
    await vi.waitFor(() => expect(refreshCadenceMs(repaints)).toBe(1_000));

    chartFps = 30;
    // The follower polls every two seconds, so the wait is for a poll rather
    // than for a frame.
    await vi.waitFor(
      () => expect(refreshCadenceMs(repaints)).toBe(Math.ceil(1_000 / 30)),
      { timeout: 5_000 },
    );

    expect(refreshLoopsStarted()).toBe(1);
  });
});

describe("a rejection that arrives after the scene mounted", () => {
  it("replaces the display that was already drawn", async () => {
    const host = skeleton();
    history.replaceState({}, "", `/?theme=${THEME_ID}`);
    vi.stubGlobal("EventSource", SilentEventSource);
    Object.defineProperty(window, "fetch", {
      configurable: true,
      writable: true,
      value: vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith("/document") ? json(servedEnvelope()) : json({}),
      ),
    });
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});

    // `main.ts` runs on import, so the DOM above has to exist first.
    await import("./main.js");
    await vi.waitFor(
      () => {
        expect(
          document.querySelector("[data-yunari-load-failure]"),
        ).not.toBeNull();
      },
      { timeout: 10_000 },
    );

    // The refusal is the real one. Nothing here mocks `reviveThemeEnvelope` or
    // anything else `@yunari/scene-fabric` exports; the only stubs are the
    // network (`fetch`, `EventSource`).
    expect(
      warned.mock.calls.find(
        ([, error]) =>
          error instanceof Error &&
          /incompatible with this runtime/.test(error.message),
      ),
      "the rejection must be the compatibility check's own, not a stubbed one",
    ).toBeDefined();

    // The display was mounted and had its canvas before that rejection landed —
    // without this the case would be an early failure wearing a late one's name.
    // The assertion establishes that the canvas *existed*, not that it existed
    // before the refusal; the discrimination between an early and a late refusal
    // comes from the deliberate break (hoisting the check above the mount), not
    // from this assertion.
    expect(
      host.querySelector('canvas[data-yunari="artboard"]'),
      "the scene never mounted, so this is not the post-mount path",
    ).not.toBeNull();

    // And the failure document is what the page shows instead: the artboard,
    // its chrome and the mounted scene are all gone.
    expect(host.isConnected).toBe(false);
    expect(document.getElementById("yunari-chrome-top")).toBeNull();
    expect(document.getElementById("yunari-chrome-bottom")).toBeNull();
    expect(
      document.querySelector("[data-yunari-load-failure]")?.parentElement,
    ).toBe(document.body);
  });
});

/**
 * The display mounts the background it was served.
 *
 * The theme's background is its own envelope section now, so the player has to
 * hand it to the scene beside the artboard; the colour is the plan's paint and
 * the media is the scene's own layer. Both are read off the mounted document,
 * because the failure this pins is a background that validates and then paints
 * nothing.
 */
describe("the background the display mounts with", () => {
  beforeEach(() => {
    // `main.ts` runs on import and a case above has already evaluated it; a
    // cached module would never run its start sequence against this stub.
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("paints the authored colour and mounts its media", async () => {
    const host = skeleton();
    history.replaceState({}, "", "/?theme=living-room");
    vi.stubGlobal("EventSource", SilentEventSource);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(0);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(
      () => undefined,
    );
    Object.defineProperty(window, "fetch", {
      configurable: true,
      writable: true,
      value: vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith("/document")
          ? json({
              ...(mountedEnvelope() as Record<string, unknown>),
              background: {
                color: { ref: "palette.ink" },
                media: { assetId: "bg", bounds: "theme" },
              },
              globals: {
                palette: {
                  none: {
                    name: "None",
                    value: { kind: "solid", color: "transparent" },
                  },
                  ink: {
                    name: "Ink",
                    value: { kind: "solid", color: "#112233" },
                  },
                },
              },
              assets: [{ id: "bg", kind: "image", path: "assets/bg.png" }],
            })
          : json({}),
      ),
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await import("./main.js");
    await vi.waitFor(
      () =>
        expect(
          host.querySelector("[data-yunari-background-media] img"),
          "the media layer mounted",
        ).not.toBeNull(),
      { timeout: 10_000 },
    );

    expect(
      document.querySelector("[data-yunari-load-failure]"),
      "the display mounted",
    ).toBeNull();
    expect(host.style.background, "the plan painted the authored colour").toBe(
      "rgb(17, 34, 51)",
    );
  });
});

/** Valid to the compatibility check, so the display mounts whole and reaches
 *  the point where its chrome is built. */
function mountedEnvelope(): unknown {
  return {
    schemaVersion: 2,
    fabricVersion: "7.4.0",
    id: "living-room",
    artboard: { width: 1920, height: 1080 },
    metadata: { themeLanguage: "en" },
    scene: { version: "7.4.0", objects: [] },
  };
}

/**
 * The chooser's mount condition, driven through the real `main.ts`.
 *
 * A link page's id is the person's instruction, and `reResolveUrl` keeps it
 * (`publish-follower.ts:60-62` drops `theme` only for `map`), so a chooser
 * mounted there would write the map and then reload onto the link's theme —
 * the control appearing to do nothing. The hop from a chosen id to
 * `reResolveUrl` is not asserted here: jsdom does not navigate, `reResolveUrl`
 * is unit-tested in `publish-follower.test.ts`, and the hop itself is the
 * Phase 4 gate's browser run.
 */
describe("the theme chooser's mount condition", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Mounts the player at `search` and waits until its chrome has been built,
   *  which is the point the chooser's condition is decided at. */
  async function mountAt(search: string): Promise<void> {
    skeleton();
    history.replaceState({}, "", `/${search}`);
    vi.stubGlobal("EventSource", SilentEventSource);
    // jsdom has no `ResizeObserver`, and the scene's re-fit observer is created
    // after the chrome: without a stub the display fails to start and the
    // failure page replaces the document this test is about.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    Object.defineProperty(window, "fetch", {
      configurable: true,
      writable: true,
      value: vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/document")) return json(mountedEnvelope());
        if (url === "/api/themes") {
          return json({ themes: [{ id: "living-room", name: "Living Room" }] });
        }
        return json({});
      }),
    });

    await import("./main.js");
    // The display's own diagnostics are not this test's news; the failure page
    // replacing the document would be, and the wait below catches that.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await vi.waitFor(
      () => {
        expect(document.querySelector("[data-yunari-load-failure]")).toBeNull();
        expect(document.querySelector("[data-yunari-controls]")).not.toBeNull();
      },
      { timeout: 10_000 },
    );
  }

  it("offers the chooser on a page the host resolved", async () => {
    await mountAt(
      "?theme=living-room&display=d1&theme-source=map&session=paired-token",
    );

    await vi.waitFor(() =>
      expect(
        document.querySelector("[data-yunari-theme-chooser]"),
      ).not.toBeNull(),
    );
  });

  it("offers nothing on a link page, whose theme id is the person's instruction", async () => {
    // The map case leaves `window.yunari` set, and `vi.resetModules()` clears
    // modules, not the window: without this the check below would read the
    // previous run's signal and prove nothing.
    Reflect.deleteProperty(window, "yunari");
    // Paired, so the absence is the mount condition and not the missing token.
    await mountAt("?theme=living-room&theme-source=link&session=paired-token");

    // `mountAt` waits on the controls (`main.ts:186`), which mount before the
    // chooser's condition is decided (`:204`). `window.yunari` is set at the
    // end of that same start sequence (`:245`), after the decision, so awaiting
    // it is what makes the absence below a fact about the decision rather than
    // about a wait that stopped short of it.
    const diagnostics = window as unknown as { readonly yunari?: unknown };
    await vi.waitFor(() => expect(diagnostics.yunari).toBeDefined());

    expect(document.querySelector("[data-yunari-theme-chooser]")).toBeNull();
  });
});

/**
 * The record a load writes, driven through the real `main.ts`.
 *
 * The load itself writes a token-bearing record from the URL, so the assertion
 * is the **identity** — the half only `GET /api/host` can supply — and the wait
 * is on that rather than on the record existing, which would pass before the
 * call was even made. `localStorage` outlives `vi.resetModules()`, which clears
 * modules and not the window, so it is cleared first.
 */
describe("the pairing a load remembers", () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("records the host's identity beside this load's own address", async () => {
    skeleton();
    history.replaceState({}, "", "/?theme=living-room&session=paired-token");
    vi.stubGlobal("EventSource", SilentEventSource);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    Object.defineProperty(window, "fetch", {
      configurable: true,
      writable: true,
      value: vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/document")) return json(mountedEnvelope());
        if (url === "/api/host") {
          return json({ id: "h1", name: "study-pc", port: 5227 });
        }
        return json({});
      }),
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // **Whether a write happened is a question only the key can answer, and here
    // it has to be counted rather than read.** `rememberPairing` writes the good
    // record over whatever is there, so the value below is the same whether or
    // not `displaySession` wrote an empty one first — a second writer leaves a
    // second write and no other trace (R72, R76).
    const writes = vi.spyOn(Storage.prototype, "setItem");

    await import("./main.js");
    await vi.waitFor(() =>
      expect(readStoredPairing(window.localStorage)?.hostId).toBe("h1"),
    );

    expect(readStoredPairing(window.localStorage)).toEqual({
      hostId: "h1",
      hostName: "study-pc",
      port: 5227,
      token: "paired-token",
      lastAddress: window.location.hostname,
    });

    expect(writes.mock.calls.map(([key]) => key)).toEqual([
      PAIRING_STORAGE_KEY,
    ]);
  });
});
