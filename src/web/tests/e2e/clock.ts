import type { Page } from "@playwright/test";

/**
 * The one way a browser test gets a deterministic clock.
 *
 * ## `install` does not stop time, and the whole suite assumed it did
 *
 * `playwright.config.ts` used to say the time base is pinned "so freezing it
 * freezes the frame". It was not frozen. Measured against playwright-core
 * 1.63.0, in this repo, on this machine:
 *
 * | | drift over real time |
 * |---|---|
 * | `install({ time })` alone | **1213 ms** over 1200 ms |
 * | `pauseAt(time)` | **0 ms** over 800 ms |
 *
 * The mechanism is in `coreBundle.js`: the in-page clock's `_replayLogOnce`,
 * reached from every `Date.now` and `performance.now` accessor, calls
 * `_innerResume()` unless `isPaused` — and `isPaused` is set **only** by a
 * logged `pauseAt`. So `install({ time })` pins where the clock *starts* and
 * then lets it run at wall speed.
 *
 * ## Why that produced three unexplained flakes
 *
 * The player ticks its data source on `setInterval(…, 1000)`
 * (`player/src/main.ts`), and every readout is recomputed from `Date.now()` on
 * each tick. With a wall-speed clock those ticks fire at a phase set by the
 * real time spent in `goto`, `screenshot()` and every CDP round trip — i.e. by
 * how loaded the machine is, which is why the failures moved between runs,
 * differed between the two projects sharing one preview server, and always
 * passed in isolation. A suite needed three attempts and nobody could say why.
 *
 * With the clock genuinely paused, only `runFor` moves time, which is what
 * every one of these tests already believed.
 *
 * ## It also made a recorded limitation disappear
 *
 * "Any frame with a chart in it is not byte-reproducible" was measured on both
 * ECharts renderers and written into three places. It was measuring this bug:
 * each capture happened at a different instant, so the engine correctly drew a
 * different frame. Paused, a chart frame reproduces byte-for-byte.
 *
 * Nothing asserts that now. The check that did — two screenshots of one paused
 * frame, compared byte for byte — was deleted with the fake-source fixture
 * themes it captured, and no surviving spec compares two frames. The
 * measurement stands; the guard is gone, filed as `vg-347`. Committed pixel
 * baselines are still out, for the reason that actually blocks them: CI is
 * Linux, development is Windows, glyphs differ.
 */

/** Pinned so the fake source is frozen and every frame is identical. */
export const FIXED_TIME = new Date("2026-01-01T12:00:00Z");

/**
 * Pins the clock to {@link FIXED_TIME} and **stops** it, before navigation.
 *
 * ## `pauseAt` alone, and never `install` first
 *
 * `pauseAt` installs the clock itself. The obvious spelling —
 * `install({ time })` then `pauseAt(time)` — has a race that only shows up
 * under load, and it cost a run of the suite to find: `pauseAt` is a
 * *fast-forward* and refuses to move backwards, so any real time elapsing
 * between the two CDP round trips makes the target the past and the call
 * throws `Cannot fast-forward to the past`. Measured with the two calls: one
 * failure per full suite run, always on the loaded project, never in isolation.
 * With one call there is no interval to lose.
 *
 * Measured with `pauseAt` alone: `Date.now()` is exactly `FIXED_TIME`, drifts
 * **0 ms** across 800 ms of real time, and moves by exactly what `runFor` asks
 * for.
 *
 * ## Before navigation, so the page boots on a stopped clock
 *
 * Survivable here, and worth knowing why: nothing in the player's mount path
 * waits on a timer. The DOM is built synchronously from the first plan, and
 * ECharts creates its `<canvas>` during `init` rather than on the frame that
 * first paints it — so every selector these tests wait for appears without the
 * clock moving. Everything that *does* need time to pass — entrance
 * animations, the 1 Hz data tick, transition frames — is driven by an explicit
 * `runFor`, which is what every test in this suite already believed.
 */
export async function installFixedClock(page: Page): Promise<void> {
  const context = page.context();

  if (installed.has(context)) {
    return;
  }

  installed.add(context);

  await page.clock.pauseAt(FIXED_TIME);
}

/**
 * Contexts already carrying a stopped clock.
 *
 * Pausing twice throws `Cannot fast-forward to the past`: the clock persists,
 * so by the second call it has been advanced past {@link FIXED_TIME} by
 * whatever `runFor` ran in between, and `pauseAt` only moves forwards.
 * Measured: pause, navigate, `runFor(1500)`, navigate twice more, and
 * `Date.now()` is still exactly `FIXED_TIME + 1500`.
 *
 * **Keyed by context, not by page**, which is not obvious and was wrong first:
 * `page.clock` reads like a page-scoped fixture and is backed by the browser
 * context, so a fresh `context.newPage()` inherits the *advanced* clock rather
 * than a clean one. A per-page key therefore let the second page in a test try
 * to pause a clock that had already moved. A fresh page is still worth taking
 * for a clean DOM; what it does not buy is a fresh clock.
 */
const installed = new WeakSet<object>();

/**
 * Opens a player URL on a stopped clock, and waits for the scene to mount.
 *
 * One composition rather than the same three lines at twenty-one call sites,
 * which is how the suite came to be missing the `pauseAt` everywhere at once.
 * A test needing something between installing and navigating — an init script,
 * say — calls {@link installFixedClock} and then navigates itself.
 *
 * @param ready A selector that exists once the scene has mounted. The default
 *   is the artboard; pass a chart's canvas when the test needs one built.
 */
export async function openPaused(
  page: Page,
  url: string,
  ready = '[data-yunari="artboard"]',
): Promise<void> {
  await installFixedClock(page);
  await page.goto(url);
  await page.locator(ready).first().waitFor();
}
