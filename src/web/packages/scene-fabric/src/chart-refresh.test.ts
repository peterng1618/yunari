import { describe, expect, it, vi } from "vitest";
import { startChartRefresh } from "./chart-refresh.js";

/** One fake clock with a frame queue and a timer queue, so a test advances time
 *  and whichever wake is pending — frame or timer — fires. */
function fakeFrameDriver() {
  const frames = new Map<number, FrameRequestCallback>();
  const timers = new Map<number, { callback: () => void; dueMs: number }>();
  // Every timer ever armed, including one cleared before it fired: a real
  // browser can still deliver a callback that was queued before `clearTimer`.
  const armed: (() => void)[] = [];
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
    armed.push(callback);
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
    pendingTimers: (): number => timers.size,
    /** Frames plus timers: the loop must arm exactly one of them. */
    pendingWakes: (): number => frames.size + timers.size,
    armedTimers: (): readonly (() => void)[] => armed,
    requestFrame,
    cancelFrame,
    clearTimer,
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
    // A stall's worth of time, so the clamped due time is a second past the
    // refresh rather than the old interval behind it.
    fake.run(1_034);
    expect(refresh).toHaveBeenCalledTimes(3);

    scheduler.setRate(30);
    fake.run(2_068);
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
    expect(fake.pendingWakes()).toBe(0);

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

    // 1 ms steps, so every time is an exact integer: a sum of 1000/60 lands
    // just under the second and would hide whether the due wake really fired.
    for (let ms = 1; ms <= 1_000; ms += 1) fake.run(ms);
    expect(refresh, "one repaint in the first second").toHaveBeenCalledTimes(1);
    expect(
      fake.requestFrame.mock.calls.length,
      "no frame polled between the wakes",
    ).toBeLessThanOrEqual(2);

    // The second second is a real second of sleep, not a leftover from the first.
    for (let ms = 1_001; ms <= 2_000; ms += 1) fake.run(ms);
    expect(refresh, "one more repaint in the second").toHaveBeenCalledTimes(2);
    expect(fake.requestFrame.mock.calls.length).toBeLessThanOrEqual(2);
    scheduler.dispose();
  });

  it("keeps the 30 fps cadence and requests one frame per wake", () => {
    const fake = fakeFrameDriver();
    const refresh = vi.fn();
    const scheduler = startChartRefresh(refresh, 30, fake.driver);

    fake.run(0);
    // The step is the loop's own interval, so a wake lands exactly on each due
    // time rather than on a 60 Hz grid whose rounding drifts against it.
    const frameMs = 1_000 / 30;
    for (let step = 1; step <= 30; step += 1) {
      const before = fake.requestFrame.mock.calls.length;
      fake.advance(frameMs);
      // One wake, one frame request: at 30 fps the loop polls at 30, not 60.
      expect(fake.requestFrame.mock.calls.length - before).toBe(1);
    }
    // The first wake plus one per interval: 31 repaints in the second.
    expect(refresh).toHaveBeenCalledTimes(31);
    scheduler.dispose();
  });

  it("keeps 30 fps when the due time falls between 60 Hz frames", () => {
    const fake = fakeFrameDriver();
    const refresh = vi.fn();
    const scheduler = startChartRefresh(refresh, 30, fake.driver);

    // A real 60 Hz grid, each time computed from the step. Almost every due
    // time falls between two frames, and re-anchoring on a wake late by a
    // fraction of a millisecond costs a frame at each boundary: 24 repaints.
    for (let step = 1; step <= 60; step += 1) fake.run((step * 1_000) / 60);

    expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(29);
    expect(refresh.mock.calls.length).toBeLessThanOrEqual(31);
    scheduler.dispose();
  });

  it("re-anchors a wake that missed exactly one interval", () => {
    const fake = fakeFrameDriver();
    const refresh = vi.fn();
    const scheduler = startChartRefresh(refresh, 30, fake.driver);

    const interval = 1_000 / 30;
    fake.run(0);
    expect(refresh).toHaveBeenCalledTimes(1);

    // Exactly one interval late. Treating it as "not missed" would set the
    // next due to `now`, repainting again on the very next frame.
    fake.run(2 * interval);
    expect(refresh, "the late wake refreshed").toHaveBeenCalledTimes(2);

    fake.run(2.5 * interval);
    expect(refresh, "no repaint on the frame between").toHaveBeenCalledTimes(2);

    fake.run(3 * interval);
    expect(
      refresh,
      "the following wake waited one interval",
    ).toHaveBeenCalledTimes(3);
    scheduler.dispose();
  });

  it("arms exactly one wake at a time", () => {
    const fake = fakeFrameDriver();
    const scheduler = startChartRefresh(() => {}, 30, fake.driver);

    expect(fake.pendingWakes(), "after construction").toBe(1);
    fake.run(0);
    expect(fake.pendingWakes(), "after a tick").toBe(1);

    scheduler.setRate(1);
    expect(fake.pendingWakes(), "after 30 → 1").toBe(1);
    fake.run(34);
    expect(fake.pendingWakes(), "the frame became a timer").toBe(1);

    scheduler.setRate(30);
    expect(fake.pendingWakes(), "after 1 → 30").toBe(1);

    scheduler.stop();
    expect(fake.pendingWakes(), "stopped").toBe(0);
    scheduler.start();
    expect(fake.pendingWakes(), "after start").toBe(1);
    scheduler.dispose();
    expect(fake.pendingWakes(), "disposed").toBe(0);
  });

  it("clears a pending timer on stop and on dispose", () => {
    const fake = fakeFrameDriver();
    const refresh = vi.fn();
    const scheduler = startChartRefresh(refresh, 1, fake.driver);

    fake.run(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fake.pendingTimers(), "the loop is asleep").toBe(1);

    scheduler.stop();
    expect(fake.clearTimer).toHaveBeenCalledTimes(1);
    expect(fake.pendingTimers()).toBe(0);

    scheduler.start();
    fake.run(1_000);
    expect(refresh).toHaveBeenCalledTimes(2);

    scheduler.dispose();
    expect(fake.clearTimer).toHaveBeenCalledTimes(2);
    expect(fake.pendingTimers()).toBe(0);
  });

  it("ignores a timer that fires after disposal", () => {
    const fake = fakeFrameDriver();
    const refresh = vi.fn();
    const scheduler = startChartRefresh(refresh, 1, fake.driver);

    fake.run(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    const armed = fake.armedTimers();

    // `clearTimer` cannot unqueue a callback the browser already holds.
    scheduler.dispose();
    for (const callback of armed) callback();

    expect(refresh, "a disposed loop repainted").toHaveBeenCalledTimes(1);
    expect(fake.pendingFrames(), "a disposed loop asked for a frame").toBe(0);
  });

  it("drops the intervals it missed after a stall at 1 fps", () => {
    const fake = fakeFrameDriver();
    const refresh = vi.fn();
    const scheduler = startChartRefresh(refresh, 1, fake.driver);

    fake.run(0);
    expect(refresh).toHaveBeenCalledTimes(1);

    // 59 s with no wake: a backgrounded tab or a back/forward-cache freeze.
    fake.run(59_000);
    expect(refresh, "the resume repaint").toHaveBeenCalledTimes(2);
    fake.run(59_500);
    expect(refresh, "no replay of the missed intervals").toHaveBeenCalledTimes(
      2,
    );

    // The next repaint is one second after the resume, not one per interval.
    fake.run(60_000);
    expect(refresh).toHaveBeenCalledTimes(3);
    scheduler.dispose();
  });

  it("drops the intervals it missed after a stall at 30 fps", () => {
    const fake = fakeFrameDriver();
    const refresh = vi.fn();
    const scheduler = startChartRefresh(refresh, 30, fake.driver);

    fake.run(0);
    fake.run(59_000);
    expect(refresh).toHaveBeenCalledTimes(2);

    // Two seconds of frames after the gap: the cadence, not one repaint per
    // frame while the loop catches up. The bound is the unbroken cadence's
    // (60 intervals in two seconds), not a re-anchored slower one's.
    for (let ms = 59_001; ms <= 61_000; ms += 1) fake.run(ms);
    expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(60);
    expect(refresh.mock.calls.length).toBeLessThanOrEqual(61);
    scheduler.dispose();
  });
});
