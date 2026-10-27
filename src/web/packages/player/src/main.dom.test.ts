// @vitest-environment jsdom
// @vitest-environment-options {"url": "http://192.168.1.10:5227/"}
// The re-find cases below need this LAN origin: `sweepAddresses("localhost")` is
// empty, so on the default jsdom origin there is no sweep to assert and both
// cases go red on their own counts. Measured, not reasoned: dropping this line
// fails them (`expected +0 to be 253`), and the credential case's own
// `swept.length > 0` guard is what turns the missing origin into red rather
// than into a silent green.

import {
  chartPaintFieldsFor,
  defaultGaugeSettings,
  defaultLineSettings,
  type SampleSource,
} from "@yunari/renderer-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PAIRING_STORAGE_KEY,
  readStoredPairing,
  refindTarget,
} from "./host-refind.js";
import type { PageNavigation } from "./main.js";

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
    schemaVersion: "2.0.0",
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
  async function mountWithTheHostGone(
    options: {
      readonly pageUrl?: string;
      readonly host?: Record<string, unknown>;
    } = {},
  ): Promise<{ readonly asked: Asked[] }> {
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
      options.pageUrl ??
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
          return json(
            options.host ?? { id: "h1", name: "study-pc", port: 5227 },
          );
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

  it("learns its token from the host and keeps it for a re-find", async () => {
    // A newly paired display: the cookie is HttpOnly and the URL carries no
    // session, so `GET /api/host` is the only place it can read its own token.
    await mountWithTheHostGone({
      pageUrl: "/?theme=living-room&display=d1&theme-source=map",
      host: {
        id: "h1",
        name: "study-pc",
        port: 5227,
        token: "paired-token",
      },
    });

    const pairing = readStoredPairing(window.localStorage);
    expect(pairing?.token).toBe("paired-token");

    // A re-find lands on another origin, where this host's cookie is never
    // sent: the stored token is the only thing that crosses that boundary.
    expect(refindTarget("http://192.168.1.44:5227", pairing?.token)).toBe(
      "http://192.168.1.44:5227/?session=paired-token",
    );
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
  let pendingTimers = new Map<
    number,
    { callback: () => void; dueMs: number; delayMs: number }
  >();
  let nextHandle = 0;
  let nextTimer = 0;
  let clock = 0;

  beforeEach(() => {
    vi.resetModules();
    chartFps = 1;
    pending = new Map();
    pendingTimers = new Map();
    nextHandle = 0;
    nextTimer = 0;
    clock = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  /** One wake of the loop's own clock, whichever kind is pending: at 1 fps the
   *  loop sleeps on a timer and requests no frame until it is due. The clock is
   *  monotonic across calls because the loop's schedule is. */
  function driveFrame(stepMs = 1): void {
    clock += stepMs;
    for (const [id, timer] of pendingTimers) {
      if (timer.dueMs > clock) continue;
      pendingTimers.delete(id);
      timer.callback();
    }
    const due = [...pending.values()];
    pending.clear();
    for (const callback of due) callback(clock);
  }

  /** The chart loop's own pending timer, if it has one. At 1 fps its wake is a
   *  timer; at 30 fps it requests a frame instead and arms no timer at all. The
   *  publish poll's 2 s timer is excluded by interval (`vg-107`, 0124). */
  function chartTimerDelays(): number[] {
    return [...pendingTimers.values()]
      .map((timer) => timer.delayMs)
      .filter((delay) => delay <= 1_000);
  }

  /** How many self-re-arming wakes the page keeps alive — frames and timers
   *  together, because at 1 fps the chart loop's wake is a timer while the
   *  line's own engine keeps an animation frame. The step is inside every
   *  interval, so this wake refreshes nothing: a refresh's own canvas render is
   *  one-shot and has run, and what remains is the loops.
   *
   * It is a count to compare, not a constant: the line's own engine keeps a
   * frame of its own, so the answer is "unchanged after `setRate`", not
   * "exactly one". */
  function refreshLoopsStarted(): number {
    driveFrame(0);
    return pending.size + pendingTimers.size;
  }

  /** The chart loop's own wake: a frame, or at 1 fps a timer for its interval.
   *  The follower's 2 s publish poll is neither, and counting it read 2. */
  function chartWakes(): number {
    // At most one chart interval: 1000 ms at rate 1, and at rate 30 the loop
    // arms a frame instead of a timer, so no timer is ever a chart wake.
    let timers = 0;
    for (const timer of pendingTimers.values()) {
      if (timer.delayMs <= 1_000) timers += 1;
    }
    return pending.size + timers;
  }

  /** The follower's poll wakes, which `chartWakes` excludes on purpose. */
  function pollWakes(): number {
    let polls = 0;
    for (const timer of pendingTimers.values()) {
      if (timer.delayMs === 2_000) polls += 1;
    }
    return polls;
  }

  /** Mounts the player and hands back a count of the canvas's repaints and of
   *  the follower's polls. `envelope` is the theme served, so a case can mount
   *  a display with no chart on it. */
  async function mountAt(
    search: string,
    envelope: unknown = lineEnvelope(),
  ): Promise<{
    readonly repaints: () => number;
    readonly polls: () => number;
  }> {
    let polled = 0;
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
    // The chart loop binds `window`'s timers as well as its frames, and at
    // 1 fps its wake is a timer: without this the loop's schedule lives on real
    // time and the clock below never reaches it. `vi.waitFor` uses vitest's own
    // safe timers, so the poll and mount waits are unaffected.
    vi.spyOn(window, "setTimeout").mockImplementation(
      (handler: TimerHandler, delayMs?: number): number => {
        nextTimer += 1;
        pendingTimers.set(nextTimer, {
          callback: handler as () => void,
          dueMs: clock + (delayMs ?? 0),
          delayMs: delayMs ?? 0,
        });
        return nextTimer;
      },
    );
    vi.spyOn(window, "clearTimeout").mockImplementation((id?: number) => {
      if (id !== undefined) pendingTimers.delete(id);
    });
    Object.defineProperty(window, "fetch", {
      configurable: true,
      writable: true,
      value: vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/published")) {
          polled += 1;
          // A revision and a theme that never move, so the rate is the only
          // thing the host answers differently between one poll and the next.
          return json({
            id: null,
            revision: 0,
            display: { id: "d1", theme: "living-room", chartFps },
          });
        }
        if (url.endsWith("/document")) return json(envelope);
        return json({});
      }),
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // The page's repaint now follows its live data and its text cadence, not a
    // per-frame line redraw (0124); the synthetic frame clock is the wall
    // clock, or nothing would ever be due.
    vi.spyOn(Date, "now").mockImplementation(() => clock);

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

    return {
      repaints: () => render.mock.calls.length,
      polls: () => polled,
    };
  }

  it("sleeps on a 1 s timer at the rate the host answered, not 30 fps", async () => {
    // The canvas is no longer the observable: a line redraws with its data, so
    // a display with no arrivals repaints nothing between them (0124). The
    // loop's own wake kind is what the host's rate changes.
    await mountAt(
      "?theme=living-room&display=d1&theme-source=map&session=paired-token",
    );

    await vi.waitFor(() => {
      driveFrame();
      expect(chartTimerDelays(), "the loop sleeps between wakes").toHaveLength(
        1,
      );
    });
  });

  it("follows a rate change without a reload and without a second loop", async () => {
    await mountAt(
      "?theme=living-room&display=d1&theme-source=map&session=paired-token",
    );
    await vi.waitFor(() => {
      driveFrame();
      expect(chartTimerDelays()).toHaveLength(1);
    });
    const loopsBefore = refreshLoopsStarted();

    chartFps = 30;
    // A 1 s timer armed before the answer has to fire once; stepping past it
    // is what lets the re-rated loop arm a frame instead (`setRate` does not
    // clear a wake already scheduled).
    await vi.waitFor(
      () => {
        driveFrame(1_001);
        expect(chartTimerDelays(), "the loop switched to frames").toHaveLength(
          0,
        );
      },
      { timeout: 5_000 },
    );

    // Relative here because a line's engine keeps a frame of its own; the
    // absolute pin is the chart-free case below.
    expect(refreshLoopsStarted()).toBe(loopsBefore);
  });

  it("keeps exactly one refresh frame, after mount and after setRate", async () => {
    // **Chart-free**, so the engine's animation frame is absent and the count
    // is the page's own callbacks — no callback's name is consulted. The first
    // 0 ms step consumes the one-shot canvas render the mount's refresh
    // scheduled; the interval has not passed, so nothing else is armed.
    const { polls } = await mountAt(
      "?theme=living-room&display=d1&theme-source=map&session=paired-token",
      textOnlyEnvelope(),
    );

    driveFrame(0);
    expect(chartWakes(), "one refresh wake after mount").toBe(1);
    // The poll is a 2 s timer on this same harness, and the pin above excludes
    // it by interval rather than by name: counted, it would read 2.
    expect(
      pollWakes(),
      "the publish poll, present but not a refresh wake",
    ).toBe(1);

    chartFps = 30;
    const before = polls();
    // The follower chains its wake on a timer, which this harness holds, so the
    // poll is driven rather than waited for. The wait proves only that the
    // request went out — `polls()` moves synchronously in the fetch mock — not
    // that the answer re-rated the loop; the pin below holds either way.
    driveFrame(2_000);
    await vi.waitFor(() => expect(polls()).toBeGreaterThan(before), {
      timeout: 5_000,
    });

    driveFrame(0);
    expect(chartWakes(), "setRate added no wake").toBe(1);
  });
});

/**
 * A display whose page is hidden.
 *
 * A display repaints up to thirty times a second and keeps a background video
 * decoding whether or not anyone can see it, which is battery spent on a page
 * the browser is not showing. jsdom cannot hide a page, so `document.hidden` is
 * overridden and the event dispatched by hand; the browser check in the task
 * report says which half of that was real.
 */
describe("a display whose page is hidden", () => {
  let frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  let frameTime = 0;

  beforeEach(() => {
    vi.resetModules();
    frames = new Map();
    nextFrame = 0;
    frameTime = 0;
  });

  afterEach(() => {
    Reflect.deleteProperty(document, "hidden");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  /** What the browser would report, and the event it would dispatch for it. */
  function setHidden(hidden: boolean): void {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => hidden,
    });
  }

  /** The loop's own clock: a frame is due time, and the refresh runs on it. */
  function driveFrames(count: number): void {
    for (let step = 0; step < count; step += 1) {
      frameTime += 16;
      const due = [...frames.values()];
      frames.clear();
      for (const callback of due) callback(frameTime);
    }
  }

  /** Mounts a line display. Its line redraws with its data (0124), so a
   *  visible repaint is the text pass on the loop's clock. Returns the handle's
   *  media calls as spies: `main.ts` holds the same handle object. */
  async function mountLine(envelope: unknown = lineEnvelope()): Promise<{
    readonly pause: ReturnType<typeof vi.spyOn>;
    readonly resume: ReturnType<typeof vi.spyOn>;
    readonly repaints: () => number;
  }> {
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
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      nextFrame += 1;
      frames.set(nextFrame, callback);
      return nextFrame;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((handle) => {
      frames.delete(handle);
    });
    Object.defineProperty(window, "fetch", {
      configurable: true,
      writable: true,
      value: vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/published")) {
          // 30, so the loop's wake is a frame rather than a timer and the
          // driver below is its whole clock.
          return json({
            id: null,
            revision: 0,
            display: { id: "d1", theme: "living-room", chartFps: 30 },
          });
        }
        if (url.endsWith("/document")) return json(envelope);
        return json({});
      }),
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // The synthetic frame clock is the wall clock: a line redraws with its
    // data, so the repaint that proves the loop is alive is the text pass
    // (0124).
    vi.spyOn(Date, "now").mockImplementation(() => frameTime);

    await import("./main.js");
    await vi.waitFor(() =>
      expect(
        document.querySelector("[data-yunari-controls]"),
        "the display mounted",
      ).not.toBeNull(),
    );

    const diagnostics = window as unknown as {
      readonly yunari: {
        readonly handle: {
          readonly canvas: { requestRenderAll: () => void };
          pauseMedia: () => void;
          resumeMedia: () => void;
        };
      };
    };
    const { handle } = diagnostics.yunari;
    const pause = vi.spyOn(handle, "pauseMedia");
    const resume = vi.spyOn(handle, "resumeMedia");
    const render = vi.spyOn(handle.canvas, "requestRenderAll");

    return {
      pause,
      resume,
      repaints: () => render.mock.calls.length,
    };
  }

  it("stops the loop and pauses media while hidden, and restores both", async () => {
    const { pause, resume } = await mountLine();
    // The loop's wake is a requested frame at 30 fps, not a repaint: a line
    // draws with its data and no sample arrives here (0124).
    driveFrames(1);
    expect(frames.size, "the loop is armed while visible").toBeGreaterThan(0);

    setHidden(true);
    window.dispatchEvent(new Event("visibilitychange"));

    expect(pause, "the media was paused").toHaveBeenCalledTimes(1);
    driveFrames(30);
    expect(frames.size, "nothing is armed while hidden").toBe(0);

    setHidden(false);
    window.dispatchEvent(new Event("visibilitychange"));

    expect(resume, "the media was resumed").toHaveBeenCalledTimes(1);
    expect(frames.size, "the loop restarted").toBeGreaterThan(0);
  });

  it("does not revive a loop a pagehide has disposed", async () => {
    const { resume } = await mountLine();
    window.dispatchEvent(new Event("pagehide"));
    driveFrames(10);

    setHidden(false);
    window.dispatchEvent(new Event("visibilitychange"));
    driveFrames(10);

    expect(resume, "a torn-down page resumed nothing").not.toHaveBeenCalled();
    expect(frames.size, "and armed nothing").toBe(0);
  });

  /** A line display with a video backdrop, so the media pause at mount is
   *  observable: the line keeps the refresh loop repainting, and the video's own
   *  `pause` is the call the scene's media handle makes. */
  function videoEnvelope(): unknown {
    return {
      ...(lineEnvelope() as Record<string, unknown>),
      background: { media: { assetId: "bg", bounds: "theme" } },
      assets: [{ id: "bg", kind: "video", path: "assets/bg.webm" }],
    };
  }

  it("starts paused when the page is already hidden at mount", async () => {
    // `visibilitychange` fires only on a change, so a display restored or
    // opened in a background tab never gets one. The prototype spy covers the
    // mount's own call rather than an event's.
    const paused = vi
      .spyOn(HTMLMediaElement.prototype, "pause")
      .mockImplementation(() => {});
    setHidden(true);

    await mountLine(videoEnvelope());

    expect(paused, "the media was paused at mount").toHaveBeenCalledTimes(1);
    driveFrames(30);
    expect(frames.size, "and no refresh wake was armed").toBe(0);
  });

  it("reloads for a persisted pageshow and ignores a fresh one", async () => {
    // **A navigation object of this mount's own.** Every mount in this file
    // leaves a `pageshow` listener on the shared jsdom window, so a spy on a
    // shared seam could pass from a prior mount's listener. `start` is handed
    // this object, and only the registration it makes can reach the spy.
    const target = new EventTarget();
    const reload = vi.fn();
    const navigation: PageNavigation = {
      addEventListener: (type, listener) =>
        target.addEventListener(type, listener as EventListener),
      reload,
    };

    // The harness stubs (`EventSource`, frames, `fetch`) are what a mount
    // needs; this case drives the mount through `start` rather than the import.
    await mountLine();
    const { start } = await import("./main.js");
    await start(skeleton(), navigation);
    expect(
      document.querySelector("[data-yunari-load-failure]"),
      "the second mount reached its chrome",
    ).toBeNull();

    target.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: false }),
    );
    expect(reload, "a first load reloads nothing").not.toHaveBeenCalled();

    target.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    );
    expect(
      reload,
      "a page restored from the back/forward cache reloads",
    ).toHaveBeenCalledTimes(1);
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

/**
 * The units a display paints with, driven through the real `main.ts`.
 *
 * The host answers the preference on `/api/display`, and the reading arrives on
 * the sample stream. What the case pins is the pairing: the text converts once,
 * at presentation, and the sample the source holds is still the measured
 * `3800 MHz` rather than a derived gigahertz figure.
 */
describe("the units a display paints with", () => {
  beforeEach(() => {
    vi.resetModules();
    streams.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  /** An `EventSource` the case can push a batch through. */
  const streams: RecordingEventSource[] = [];

  class RecordingEventSource {
    readonly #listeners = new Map<
      string,
      ((event: { readonly data: string }) => void)[]
    >();

    constructor() {
      streams.push(this);
    }

    addEventListener(
      type: string,
      listener: (event: { readonly data: string }) => void,
    ): void {
      const existing = this.#listeners.get(type) ?? [];
      existing.push(listener);
      this.#listeners.set(type, existing);
    }

    close(): void {}

    emit(type: string, data: string): void {
      for (const listener of this.#listeners.get(type) ?? []) {
        listener({ data });
      }
    }
  }

  it("paints a bound clock in the host's unit and keeps the sample as measured", async () => {
    skeleton();
    history.replaceState({}, "", "/?theme=units");
    vi.stubGlobal("EventSource", RecordingEventSource);
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
        if (url.endsWith("/document")) return json(unitsEnvelope());
        if (url === "/api/display") {
          return json({ settings: { units: { clock: "ghz" } }, zones: [] });
        }
        return json({});
      }),
    });
    // **The repaint cadence is driven here, not left to jsdom.** A sibling case
    // in this file installs a frame driver of its own, so the real loop's clock
    // is not a fact this case can lean on across the file's order.
    const frames: FrameRequestCallback[] = [];
    let frameTime = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    vi.spyOn(console, "warn").mockImplementation(() => {});

    await import("./main.js");
    await vi.waitFor(() =>
      expect(
        document.querySelector("[data-yunari-controls]"),
        "the display mounted",
      ).not.toBeNull(),
    );

    streams[0]!.emit(
      "samples",
      JSON.stringify({
        version: 1,
        sentAt: new Date().toISOString(),
        samples: [
          {
            semanticKey: "cpu.clock",
            sample: {
              sensorId: "cpu.clock",
              timestamp: new Date().toISOString(),
              status: "ok",
              value: 3800,
              unit: "MHz",
            },
          },
        ],
      }),
    );

    const diagnostics = window as unknown as {
      readonly yunari: {
        readonly live: { readonly source: SampleSource };
      };
    };
    await vi.waitFor(
      () =>
        expect(
          diagnostics.yunari.live.source.latest("cpu.clock")?.value,
          "the batch never reached the source",
        ).toBe(3800),
      { timeout: 5_000 },
    );

    // One second of the loop's own clock: the cadence is 30 a second, so a
    // handful of frames is more than one repaint.
    for (let frame = 0; frame < 20; frame += 1) {
      frameTime += 100;
      const due = frames.splice(0);
      for (const callback of due) callback(frameTime);
    }
    expect(readoutText(), "the text did not paint the chosen unit").toBe(
      "3.8 GHz",
    );

    expect(
      diagnostics.yunari.live.source.latest("cpu.clock")?.value,
      "the stored sample was converted instead of the displayed one",
    ).toBe(3800);
  });

  /** The mounted text object's rendered string. */
  function readoutText(): string | undefined {
    const diagnostics = window as unknown as {
      readonly yunari?: {
        readonly handle: {
          readonly canvas: {
            readonly getObjects: () => readonly {
              readonly id?: unknown;
              readonly text?: unknown;
              readonly getObjects?: () => readonly unknown[];
            }[];
          };
        };
      };
    };
    const objects = diagnostics.yunari?.handle.canvas.getObjects() ?? [];
    const readout = objects.find((object) => object.id === "readout");
    return typeof readout?.text === "string" ? readout.text : undefined;
  }

  /** One text object bound to `cpu.clock`, saved as a theme would save it. */
  function unitsEnvelope(): unknown {
    return {
      schemaVersion: "2.0.0",
      fabricVersion: "7.4.0",
      id: "units",
      artboard: { width: 1920, height: 1080 },
      metadata: { themeLanguage: "en" },
      globals: {
        typePresets: {
          body: { name: "Body", value: { family: "Inter", size: 24 } },
        },
        palette: {
          none: {
            name: "None",
            value: { kind: "solid", color: "transparent" },
          },
          ink: { name: "Ink", value: { kind: "solid", color: "#ffffff" } },
        },
      },
      bindings: {
        readout: [{ id: "clock", semanticKey: "cpu.clock", precision: 1 }],
      },
      scene: {
        version: "7.4.0",
        objects: [
          {
            type: "Textbox",
            id: "readout",
            left: 20,
            top: 20,
            width: 400,
            height: 80,
            text: "--",
            yunariText: {
              runs: [
                {
                  kind: "value",
                  bindingId: "clock",
                  typePreset: "typePresets.body",
                  style: { color: { ref: "palette.ink" } },
                },
              ],
              box: { width: 400, height: 80 },
              overflow: "visible",
            },
          },
        ],
      },
    };
  }
});

/**
 * The image side of the refresh loop, driven through the real `main.ts`.
 *
 * jsdom never decodes an image, so what is read here is the request the pass
 * made: the reading arrives on the stream, the loop runs, and the URL the
 * session resolved is the one an `<img>` was asked for. That the picture then
 * paints, and that an absolute reading never reaches one, is
 * `tests/e2e/image-binding.spec.ts`'s.
 */
describe("an image reading on the display", () => {
  const streams: ImageStreamEventSource[] = [];

  beforeEach(() => {
    vi.resetModules();
    streams.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  class ImageStreamEventSource {
    readonly #listeners = new Map<
      string,
      ((event: { readonly data: string }) => void)[]
    >();

    constructor() {
      streams.push(this);
    }

    addEventListener(
      type: string,
      listener: (event: { readonly data: string }) => void,
    ): void {
      const existing = this.#listeners.get(type) ?? [];
      existing.push(listener);
      this.#listeners.set(type, existing);
    }

    close(): void {}

    emit(type: string, data: string): void {
      for (const listener of this.#listeners.get(type) ?? []) {
        listener({ data });
      }
    }
  }

  function imageEnvelope(): unknown {
    return {
      schemaVersion: "2.0.0",
      fabricVersion: "7.4.0",
      id: "images",
      artboard: { width: 1920, height: 1080 },
      metadata: { themeLanguage: "en" },
      globals: {
        palette: {
          none: {
            name: "None",
            value: { kind: "solid", color: "transparent" },
          },
          ink: { name: "Ink", value: { kind: "solid", color: "#ffffff" } },
        },
        typePresets: {},
      },
      bindings: {
        artwork: [{ id: "image", semanticKey: "media.artwork" }],
      },
      scene: {
        version: "7.4.0",
        objects: [
          {
            type: "Image",
            id: "artwork",
            left: 20,
            top: 20,
            width: 200,
            height: 200,
            // jsdom's canvas cannot draw an image, and this case is about the
            // request the pass makes rather than the paint. The browser proof
            // draws it (`tests/e2e/image-binding.spec.ts`).
            opacity: 0,
          },
        ],
      },
    };
  }

  it("asks the host for the image a reading names", async () => {
    skeleton();
    history.replaceState({}, "", "/?theme=images");
    vi.stubGlobal("EventSource", ImageStreamEventSource);
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
        if (url.endsWith("/document")) return json(imageEnvelope());
        if (url === "/api/display") return json({ settings: {}, zones: [] });
        return json({});
      }),
    });
    const frames: FrameRequestCallback[] = [];
    let frameTime = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    // Every `<img>` the refresh loop asks for, once the scene has mounted.
    const create = document.createElement.bind(document);
    const requested: HTMLImageElement[] = [];
    vi.spyOn(document, "createElement").mockImplementation(((
      name: string,
      options?: ElementCreationOptions,
    ) => {
      const element = create(name, options);
      if (name === "img") requested.push(element as HTMLImageElement);
      return element;
    }) as typeof document.createElement);

    await import("./main.js");
    await vi.waitFor(() =>
      expect(
        document.querySelector("[data-yunari-controls]"),
        "the display mounted",
      ).not.toBeNull(),
    );

    streams[0]!.emit(
      "samples",
      JSON.stringify({
        version: 1,
        sentAt: new Date().toISOString(),
        samples: [
          {
            semanticKey: "media.artwork",
            sample: {
              sensorId: "media.artwork",
              timestamp: new Date().toISOString(),
              status: "ok",
              textValue: "/api/themes/images/assets/live.png",
            },
          },
        ],
      }),
    );

    for (let frame = 0; frame < 20; frame += 1) {
      frameTime += 100;
      const due = frames.splice(0);
      for (const callback of due) callback(frameTime);
    }

    expect(
      requested.some((element) =>
        element.src.endsWith("/api/themes/images/assets/live.png"),
      ),
      "the reading's image was never requested",
    ).toBe(true);
  });
});

/** Valid to the compatibility check, so the display mounts whole and reaches
 *  the point where its chrome is built. */
function mountedEnvelope(): unknown {
  return {
    schemaVersion: "2.0.0",
    fabricVersion: "7.4.0",
    id: "living-room",
    artboard: { width: 1920, height: 1080 },
    metadata: { themeLanguage: "en" },
    scene: { version: "7.4.0", objects: [] },
  };
}

/** The defaults with every paint pointed at a palette token: a persisted chart
 *  references tokens, never a literal colour. */
function painted(
  family: "gauge" | "line",
  settings: object,
): Record<string, unknown> {
  const paintedSettings: Record<string, unknown> = { ...settings };

  for (const field of chartPaintFieldsFor(family)) {
    paintedSettings[field.property] =
      field.multiple === true
        ? [{ ref: "palette.ink" }]
        : { ref: "palette.ink" };
  }

  return paintedSettings;
}

/**
 * A theme whose line chart repaints on every refresh.
 *
 * The loop's own cadence is only visible through a repaint now that an idle
 * display — one whose samples have not changed — deliberately asks for none. A
 * line is the honest sample of that: its window slides with the clock, so every
 * refresh rebuilds its option whether or not a sample arrived.
 */
function lineEnvelope(): unknown {
  return {
    schemaVersion: "2.0.0",
    fabricVersion: "7.4.0",
    id: "living-room",
    artboard: { width: 1920, height: 1080 },
    metadata: { themeLanguage: "en" },
    globals: {
      palette: {
        none: { name: "None", value: { kind: "solid", color: "transparent" } },
        ink: { name: "Ink", value: { kind: "solid", color: "#ffffff" } },
      },
      typePresets: {},
    },
    bindings: { line: [{ id: "l", semanticKey: "cpu.load.total" }] },
    scene: {
      version: "7.4.0",
      objects: [
        {
          type: "YunariChart",
          id: "line",
          left: 100,
          top: 100,
          width: 400,
          height: 200,
          family: "line",
          settings: painted("line", defaultLineSettings),
        },
      ],
    },
  };
}

/**
 * A theme whose only repaintable work is bound text: no chart, so the only
 * canvas render a refresh can ask for is the refresh branch's own.
 */
function textOnlyEnvelope(): unknown {
  return {
    schemaVersion: "2.0.0",
    fabricVersion: "7.4.0",
    id: "text-only",
    artboard: { width: 1920, height: 1080 },
    metadata: { themeLanguage: "en" },
    globals: {
      palette: {
        none: { name: "None", value: { kind: "solid", color: "transparent" } },
        ink: { name: "Ink", value: { kind: "solid", color: "#ffffff" } },
      },
      typePresets: {
        body: { name: "Body", value: { family: "Inter", size: 24 } },
      },
    },
    bindings: {
      readout: [{ id: "t", semanticKey: "cpu.load.total" }],
    },
    scene: {
      version: "7.4.0",
      objects: [
        {
          type: "Textbox",
          id: "readout",
          left: 100,
          top: 100,
          width: 400,
          height: 80,
          text: "--",
          yunariText: {
            runs: [
              {
                kind: "value",
                bindingId: "t",
                typePreset: "typePresets.body",
                style: { color: { ref: "palette.ink" } },
              },
            ],
            box: { width: 400, height: 80 },
            overflow: "visible",
          },
        },
      ],
    },
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

/**
 * The language half of the sample stream's wire shape, driven through the real
 * `main.ts`: the host localizes per display and never reads a theme record to
 * learn this display's language, so the loaded theme's own `themeLanguage` has
 * to ride the URL beside `keys`.
 */
describe("the language a display sends with its samples", () => {
  const urls: string[] = [];

  class RecordingEventSource {
    constructor(url: string | URL) {
      urls.push(String(url));
    }

    addEventListener(): void {}
    close(): void {}
  }

  beforeEach(() => {
    vi.resetModules();
    urls.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Mounts a display showing a theme whose declared language is `language`,
   *  and returns the sample stream URL it opened. The document starts in
   *  another language, so a read of `document.documentElement.lang` instead of
   *  the theme's own metadata cannot pass as the sent value. */
  async function mountWithLanguage(language: string): Promise<URL> {
    skeleton();
    document.documentElement.lang = "fr";
    history.replaceState({}, "", "/?theme=living-room");
    vi.stubGlobal("EventSource", RecordingEventSource);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );

    const envelope = mountedEnvelope() as Record<string, unknown>;
    envelope["metadata"] = { themeLanguage: language };

    Object.defineProperty(window, "fetch", {
      configurable: true,
      writable: true,
      value: vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/document")) return json(envelope);
        return json({});
      }),
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await import("./main.js");
    await vi.waitFor(() => expect(urls.length).toBeGreaterThan(0));

    return new URL(urls[0]!, window.location.href);
  }

  it("sends the loaded theme's language beside the keys", async () => {
    const url = await mountWithLanguage("de-DE");

    expect(url.pathname).toBe("/ws");
    expect(url.searchParams.has("keys")).toBe(true);
    expect(url.searchParams.get("lang")).toBe("de-DE");
    // The theme's tag, not the document language `declareDocumentLanguage`
    // would have reduced it to.
    expect(document.documentElement.lang).not.toBe("de-DE");
  });
});

/**
 * The work one refresh frame does, driven through the real `main.ts`.
 *
 * Bound text, bound images and the availability notice only change when a
 * sample arrives, and `SampleSource.revision` is what says one did. A value
 * chart redraws only when its own reading moves; a line is the exception,
 * because its window slides with the clock and its signature carries the
 * instant it will be drawn at, so it redraws every frame.
 */
describe("the work one refresh frame does", () => {
  beforeEach(() => {
    vi.resetModules();
    streams.length = 0;
    frames.length = 0;
    frameTime = 0;
    // The frame clock is the display's own: a line's signature carries the
    // instant it draws at, so the frames this suite drives must move the clock
    // the player reads, not the wall clock in between iterations.
    vi.spyOn(Date, "now").mockImplementation(() => frameTime);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  const streams: RevisionStreamEventSource[] = [];
  const frames: FrameRequestCallback[] = [];
  let frameTime = 0;

  class RevisionStreamEventSource {
    readonly #listeners = new Map<
      string,
      ((event: { readonly data: string }) => void)[]
    >();

    constructor() {
      streams.push(this);
    }

    addEventListener(
      type: string,
      listener: (event: { readonly data: string }) => void,
    ): void {
      const existing = this.#listeners.get(type) ?? [];
      existing.push(listener);
      this.#listeners.set(type, existing);
    }

    close(): void {}

    emit(type: string, data: string): void {
      for (const listener of this.#listeners.get(type) ?? []) {
        listener({ data });
      }
    }
  }

  /** One frame of the loop's own clock. The cadence is 30 a second, so a
   *  100 ms step is past every interval. */
  function driveFrame(): void {
    frameTime += 100;
    const due = frames.splice(0);
    for (const callback of due) callback(frameTime);
  }

  function batch(value: number, timestamp: string): string {
    return JSON.stringify({
      version: 1,
      sentAt: timestamp,
      samples: [
        {
          semanticKey: "cpu.load.total",
          sample: {
            sensorId: "cpu.load.total",
            timestamp,
            status: "ok",
            value,
            unit: "%",
          },
        },
      ],
    });
  }

  function liveRevision(): number {
    const diagnostics = window as unknown as {
      readonly yunari?: {
        readonly live: { readonly source: SampleSource };
      };
    };
    return diagnostics.yunari?.live.source.revision ?? -1;
  }

  /** Mounts a display and returns the spies the frame cases count. The spies are
   *  taken from the module instances `main.ts` itself imports — `beforeEach`
   *  reset the registry, so importing first is what makes them the same ones. */
  async function mount(envelope: unknown) {
    skeleton();
    history.replaceState({}, "", "/?theme=revisions");
    vi.stubGlobal("EventSource", RevisionStreamEventSource);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(
      () => undefined,
    );
    Object.defineProperty(window, "fetch", {
      configurable: true,
      writable: true,
      value: vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/document")) return json(envelope);
        if (url === "/api/display") return json({ settings: {}, zones: [] });
        return json({});
      }),
    });
    const warned = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const { YunariChart } = await import("@yunari/scene-fabric");
    const { FabricObject, StaticCanvas } = await import("fabric/es");
    const setOption = vi.spyOn(YunariChart.prototype, "setOption");
    const set = vi.spyOn(FabricObject.prototype, "set");
    // On the prototype, so the mount's own render is counted too: the canvas
    // does not exist until `main.ts` mounts it.
    const requestRenderAll = vi.spyOn(
      StaticCanvas.prototype,
      "requestRenderAll",
    );
    await import("./main.js");
    await vi.waitFor(() =>
      expect(
        document.querySelector("[data-yunari-controls]"),
        "the display mounted",
      ).not.toBeNull(),
    );

    setOption.mockClear();
    set.mockClear();
    requestRenderAll.mockClear();

    return { setOption, set, requestRenderAll, warned };
  }

  /** `set` calls that wrote text; the layout passes also set geometry. */
  function textWrites(set: {
    readonly mock: { readonly calls: unknown[][] };
  }): number {
    return set.mock.calls.filter(
      ([written]) =>
        typeof written === "object" &&
        written !== null &&
        "text" in (written as Record<string, unknown>),
    ).length;
  }

  function setOptionCalls(
    setOption: { readonly mock: { readonly contexts: unknown[] } },
    family: "gauge" | "line",
  ): number {
    return setOption.mock.contexts.filter(
      (self) => (self as { readonly family?: string }).family === family,
    ).length;
  }

  it("redraws the line once per revision, like the rest", async () => {
    const { setOption, set } = await mount(revisionsEnvelope(true));
    streams[0]!.emit("samples", batch(42, "2026-01-01T00:00:10.000Z"));
    await vi.waitFor(() => expect(liveRevision()).toBe(1));

    for (let frame = 0; frame < 30; frame += 1) driveFrame();

    expect(setOptionCalls(setOption, "gauge"), "the gauge repainted once").toBe(
      1,
    );
    expect(
      setOptionCalls(setOption, "line"),
      "the line repainted once, not every frame",
    ).toBe(1);
    expect(textWrites(set), "the bound text repainted once").toBe(1);

    // A second accepted ingest is a second revision: every family updates once.
    streams[0]!.emit("samples", batch(43, "2026-01-01T00:00:11.000Z"));
    await vi.waitFor(() => expect(liveRevision()).toBe(2));
    driveFrame();

    expect(setOptionCalls(setOption, "gauge")).toBe(2);
    expect(setOptionCalls(setOption, "line")).toBe(2);
    expect(textWrites(set)).toBe(2);
  });

  it("asks for no repaint when no sample has arrived", async () => {
    const { requestRenderAll } = await mount(revisionsEnvelope(false));

    for (let frame = 0; frame < 30; frame += 1) driveFrame();

    // The mount's own first refresh is the last repaint this display earned:
    // nothing it shows has changed since.
    expect(requestRenderAll).not.toHaveBeenCalled();
  });

  it("repaints the scene for a sample that arrived", async () => {
    // **Text only**, so no chart's own `setOption` can request the render: a
    // canvas render on these frames can only come from the refresh branch and
    // the binding pass. `refreshBoundText` asks for one render of its own, so
    // the sample's frame is two calls with the branch and one without it — the
    // pin fails if the branch is deleted. The mount's own total is not pinned:
    // mounting the scene asks for renders of its own, which have nothing to do
    // with this gate.
    const { requestRenderAll } = await mount(textOnlyEnvelope());

    for (let frame = 0; frame < 30; frame += 1) driveFrame();
    expect(
      requestRenderAll,
      "idle frames repainted nothing",
    ).not.toHaveBeenCalled();

    streams[0]!.emit("samples", batch(42, "2026-01-01T00:00:10.000Z"));
    await vi.waitFor(() => expect(liveRevision()).toBe(1));
    driveFrame();

    expect(
      requestRenderAll,
      "the binding pass and the refresh branch",
    ).toHaveBeenCalledTimes(2);
  });

  it("reports a line's unmapped key once, not every frame", async () => {
    // A line asks for its diagnostics on every frame, because its reading — and
    // so its signature — moves with the clock. What keeps the display readable
    // is the per-node dedupe: the fault is reported once, not once a frame.
    const { warned } = await mount(revisionsEnvelope(true, "cpu.load.absent"));
    const unmapped = (): number =>
      warned.mock.calls.filter(
        ([message]) =>
          typeof message === "string" &&
          message.includes('No sensor is mapped to "cpu.load.absent"'),
      ).length;

    expect(unmapped(), "the mount reported the unmapped key").toBe(1);

    for (let frame = 0; frame < 30; frame += 1) driveFrame();
    expect(unmapped(), "idle frames reported nothing new").toBe(1);

    streams[0]!.emit("samples", batch(42, "2026-01-01T00:00:10.000Z"));
    await vi.waitFor(() => expect(liveRevision()).toBe(1));
    driveFrame();

    expect(unmapped(), "the dedupe kept it to one line").toBe(1);
  });

  it("reports a line's paint that names no global", async () => {
    // The other half of the diagnostics: the line body's own paint resolution,
    // which also lives in `collectChartIssues` and used to be reported by
    // `buildChartPlan` for every family.
    //
    // **The fault is put on the revived chart, not on the served document.** A
    // hosted document cannot carry a dangling paint — `readFabricThemeEnvelope`
    // refuses it ("Chart paint must reference an existing palette token",
    // measured) — so a served fixture would test the loader, not this report.
    // A chart whose settings arrive unresolved is the case the report exists
    // for, and the next sample is what asks the line for its diagnostics.
    const { warned } = await mount(revisionsEnvelope(true));
    const canvas = (
      window as unknown as {
        readonly yunari: {
          readonly handle: {
            readonly canvas: {
              getObjects: () => readonly {
                readonly family?: unknown;
                readonly settings?: unknown;
                set(key: string, value: unknown): void;
              }[];
            };
          };
        };
      }
    ).yunari.handle.canvas;
    const line = canvas
      .getObjects()
      .find((object) => object.family === "line")!;

    line.set("settings", {
      ...(line.settings as Record<string, unknown>),
      stroke: { ref: "palette.missing" },
    });

    streams[0]!.emit("samples", batch(42, "2026-01-01T00:00:10.000Z"));
    await vi.waitFor(() => expect(liveRevision()).toBe(1));
    driveFrame();

    expect(
      warned.mock.calls.filter(
        ([message]) =>
          typeof message === "string" &&
          message.includes('Chart paint "palette.missing" is not defined'),
      ).length,
    ).toBe(1);
  });

  /** A gauge, a bound reading, and optionally the line that keeps moving.
   *  `lineKey` is a key nothing maps, for the diagnostics case. */
  function revisionsEnvelope(
    withLine: boolean,
    lineKey = "cpu.load.total",
  ): unknown {
    return {
      schemaVersion: "2.0.0",
      fabricVersion: "7.4.0",
      id: "revisions",
      artboard: { width: 1920, height: 1080 },
      metadata: { themeLanguage: "en" },
      globals: {
        palette: {
          none: {
            name: "None",
            value: { kind: "solid", color: "transparent" },
          },
          ink: { name: "Ink", value: { kind: "solid", color: "#ffffff" } },
        },
        typePresets: {
          body: { name: "Body", value: { family: "Inter", size: 24 } },
        },
      },
      bindings: {
        gauge: [{ id: "g", semanticKey: "cpu.load.total" }],
        readout: [{ id: "t", semanticKey: "cpu.load.total" }],
        ...(withLine ? { line: [{ id: "l", semanticKey: lineKey }] } : {}),
      },
      scene: {
        version: "7.4.0",
        objects: [
          {
            type: "YunariChart",
            id: "gauge",
            left: 100,
            top: 100,
            width: 300,
            height: 300,
            family: "gauge",
            settings: painted("gauge", defaultGaugeSettings),
          },
          ...(withLine
            ? [
                {
                  type: "YunariChart",
                  id: "line",
                  left: 500,
                  top: 100,
                  width: 400,
                  height: 200,
                  family: "line",
                  settings: painted("line", defaultLineSettings),
                },
              ]
            : []),
          {
            type: "Textbox",
            id: "readout",
            left: 100,
            top: 500,
            width: 400,
            height: 80,
            text: "--",
            yunariText: {
              runs: [
                {
                  kind: "value",
                  bindingId: "t",
                  typePreset: "typePresets.body",
                  style: { color: { ref: "palette.ink" } },
                },
              ],
              box: { width: 400, height: 80 },
              overflow: "visible",
            },
          },
        ],
      },
    };
  }
});
