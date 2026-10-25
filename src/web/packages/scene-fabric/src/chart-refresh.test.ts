import { describe, expect, it, vi } from "vitest";
import { startChartRefresh } from "./chart-refresh.js";

/** One fake clock with a frame queue and a timer queue, so a test advances time
 *  and whichever wake is pending — frame or timer — fires. */
function fakeFrameDriver() {
  const frames = new Map<number, FrameRequestCallback>();
  const timers = new Map<number, { callback: () => void; dueMs: number }>();
  let nextFrame = 0;
  let nextTimer = 0;
  let nowMs = 0;

  const requestFrame = vi.fn((callback: FrameRequestCallback): number => {
    nextFrame += 1;
    frames.set(nextFrame, callback);
    return nextFrame;
  });
  const cancelFrame = vi.fn((frame: number) => {
    frames.delete(frame);
  });
  const setTimer = vi.fn((callback: () => void, delayMs: number): number => {
    nextTimer += 1;
    timers.set(nextTimer, { callback, dueMs: nowMs + delayMs });
    return nextTimer;
  });
  const clearTimer = vi.fn((id: number) => {
    timers.delete(id);
  });

  const run = (atMs: number): void => {
    nowMs = atMs;
    for (const [id, timer] of timers) {
      if (timer.dueMs > nowMs) continue;
      timers.delete(id);
      timer.callback();
    }
    const id = frames.keys().next().value;
    if (id === undefined) return;
    const callback = frames.get(id);
    frames.delete(id);
    callback?.(nowMs);
  };

  return {
    driver: { requestFrame, cancelFrame, setTimer, clearTimer },
    run,
    advance: (delayMs: number): void => run(nowMs + delayMs),
    pendingFrames: (): number => frames.size,
    pendingFrame: (): number | undefined => frames.keys().next().value,
    requestFrame,
    cancelFrame,
  };
}

describe("startChartRefresh", () => {
  it("caps redraws at the selected rate and stops on disposal", () => {
    const fake = fakeFrameDriver();
    const refresh = vi.fn();
    const scheduler = startChartRefresh(refresh, 30, fake.driver);

    fake.run(0);
    fake.run(16);
    fake.run(34);
    expect(refresh).toHaveBeenCalledTimes(2);

    scheduler.setRate(1);
    fake.run(50);
    fake.run(1_034);
    expect(refresh).toHaveBeenCalledTimes(3);

    scheduler.setRate(30);
    fake.run(1_068);
    expect(refresh).toHaveBeenCalledTimes(4);

    scheduler.dispose();
    expect(fake.cancelFrame).toHaveBeenCalledTimes(1);
  });

  it("keeps repainting after a refresh throws, and reports it once", () => {
    const fake = fakeFrameDriver();
    const onError = vi.fn();
    let throws = true;
    const refresh = vi.fn(() => {
      if (throws) throw new Error("setOption blew up");
    });
    const scheduler = startChartRefresh(refresh, 30, fake.driver, {
      onError,
    });

    // **The whole point:** one failing repaint must not end the scene's
    // repainting. Every chart, every bound text object and the clock go through
    // this one function, so a throw that stopped it would freeze the display.
    fake.run(0);
    fake.run(34);
    fake.run(68);
    expect(refresh).toHaveBeenCalledTimes(3);
    // Deduped, or a failing chart would log on every frame.
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toContain("setOption blew up");

    // And it recovers: a refresh that stops throwing is not reported again.
    throws = false;
    fake.run(102);
    expect(refresh).toHaveBeenCalledTimes(4);
    expect(onError).toHaveBeenCalledTimes(1);

    scheduler.dispose();
  });

  it("repaints again after the page goes away and comes back", () => {
    const fake = fakeFrameDriver();
    const refresh = vi.fn();
    const scheduler = startChartRefresh(refresh, 30, fake.driver);

    fake.run(0);
    expect(refresh).toHaveBeenCalledTimes(1);

    // The page is going away: the editor's own `pagehide`. At HEAD this was
    // `dispose`, which is one-way — and a page restored from the back/forward
    // cache came back to a loop that could never run again (vg-510).
    scheduler.stop();
    expect(fake.cancelFrame).toHaveBeenCalledTimes(1);
    expect(fake.pendingFrames()).toBe(0);

    // Nothing is scheduled while the page is away, and nothing repaints.
    expect(refresh).toHaveBeenCalledTimes(1);

    // The page came back — `pageshow`. The loop has to be running again.
    scheduler.start();
    fake.run(1_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("leaves a running loop alone when the page comes back", () => {
    const fake = fakeFrameDriver();
    const scheduler = startChartRefresh(() => {}, 30, fake.driver);

    const frame = fake.pendingFrame();
    // `pageshow` fires on the first load as well as on a return, so the editor
    // calls `start` on both. A second frame here would double the loop's work
    // for the rest of the session — the same reason `startDraftAutosave`'s
    // arming is idempotent (`draft-store.ts`).
    scheduler.start();
    expect(fake.requestFrame).toHaveBeenCalledTimes(1);
    expect(fake.pendingFrame()).toBe(frame);
    scheduler.dispose();
  });

  it("says so when a repaint fails even with nothing listening", () => {
    const fake = fakeFrameDriver();
    const scheduler = startChartRefresh(
      () => {
        throw new Error("boom");
      },
      30,
      fake.driver,
    );
    // No `onError`: the loop still has to keep going rather than throw out of a
    // frame callback, which the browser would swallow and the loop would end.
    expect(fake.pendingFrame()).toBeDefined();
    expect(() => fake.run(0)).not.toThrow();
    expect(fake.pendingFrames()).toBeGreaterThan(0);
    scheduler.dispose();
  });

  it("sleeps on a timer at 1 fps instead of polling frames", () => {
    const fake = fakeFrameDriver();
    const refresh = vi.fn();
    const scheduler = startChartRefresh(refresh, 1, fake.driver);

    for (let step = 0; step < 60; step += 1) fake.advance(1_000 / 60);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fake.requestFrame.mock.calls.length).toBeLessThanOrEqual(2);
    scheduler.dispose();
  });

  it("keeps the 30 fps frame cadence", () => {
    const fake = fakeFrameDriver();
    const refresh = vi.fn();
    const scheduler = startChartRefresh(refresh, 30, fake.driver);

    for (let step = 0; step < 60; step += 1) fake.advance(1_000 / 60);

    expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(30);
    expect(refresh.mock.calls.length).toBeLessThanOrEqual(31);
    scheduler.dispose();
  });
});
