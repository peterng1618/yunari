import { describe, expect, it, vi } from "vitest";
import { startSceneRefresh } from "./chart-refresh.js";

/** One fake frame clock, so a test advances time and the pending wake fires. */
function fakeFrameDriver() {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  let nowMs = 0;

  const requestFrame = vi.fn((callback: FrameRequestCallback): number => {
    nextFrame += 1;
    frames.set(nextFrame, callback);
    return nextFrame;
  });
  const cancelFrame = vi.fn((frame: number) => {
    frames.delete(frame);
  });

  const run = (atMs: number): void => {
    nowMs = atMs;
    const id = frames.keys().next().value;
    if (id === undefined) return;
    const callback = frames.get(id);
    frames.delete(id);
    callback?.(nowMs);
  };

  return {
    driver: { requestFrame, cancelFrame },
    run,
    advance: (delayMs: number): void => run(nowMs + delayMs),
    pendingFrames: (): number => frames.size,
    pendingFrame: (): number | undefined => frames.keys().next().value,
    requestFrame,
    cancelFrame,
  };
}

describe("startSceneRefresh", () => {
  it("caps redraws at 30 fps and stops on disposal", () => {
    const fake = fakeFrameDriver();
    const refresh = vi.fn();
    const scheduler = startSceneRefresh(refresh, fake.driver);

    fake.run(0);
    fake.run(16);
    fake.run(34);
    expect(refresh).toHaveBeenCalledTimes(2);

    scheduler.dispose();
    expect(fake.cancelFrame).toHaveBeenCalledTimes(1);
    expect(fake.pendingFrames()).toBe(0);
  });

  it("keeps repainting after a refresh throws, and reports it once", () => {
    const fake = fakeFrameDriver();
    const onError = vi.fn();
    let throws = true;
    const refresh = vi.fn(() => {
      if (throws) throw new Error("setOption blew up");
    });
    const scheduler = startSceneRefresh(refresh, fake.driver, { onError });

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
    const scheduler = startSceneRefresh(refresh, fake.driver);

    fake.run(0);
    expect(refresh).toHaveBeenCalledTimes(1);

    // The page is going away: the editor's own `pagehide`. At HEAD this was
    // `dispose`, which is one-way — and a page restored from the back/forward
    // cache came back to a loop that could never run again (vg-510).
    scheduler.stop();
    expect(fake.cancelFrame).toHaveBeenCalledTimes(1);
    expect(fake.pendingFrames()).toBe(0);
    expect(refresh).toHaveBeenCalledTimes(1);

    // The page came back — `pageshow`. The loop has to be running again.
    scheduler.start();
    fake.run(1_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("leaves a running loop alone when the page comes back", () => {
    const fake = fakeFrameDriver();
    const scheduler = startSceneRefresh(() => {}, fake.driver);

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
    const scheduler = startSceneRefresh(() => {
      throw new Error("boom");
    }, fake.driver);
    // No `onError`: the loop still has to keep going rather than throw out of a
    // frame callback, which the browser would swallow and the loop would end.
    expect(fake.pendingFrame()).toBeDefined();
    expect(() => fake.run(0)).not.toThrow();
    expect(fake.pendingFrames()).toBeGreaterThan(0);
    scheduler.dispose();
  });

  it("keeps the 30 fps cadence and requests one frame per wake", () => {
    const fake = fakeFrameDriver();
    const refresh = vi.fn();
    const scheduler = startSceneRefresh(refresh, fake.driver);

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
    const scheduler = startSceneRefresh(refresh, fake.driver);

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
    const scheduler = startSceneRefresh(refresh, fake.driver);

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
    const scheduler = startSceneRefresh(() => {}, fake.driver);

    expect(fake.pendingFrames(), "after construction").toBe(1);
    fake.run(0);
    expect(fake.pendingFrames(), "after a tick").toBe(1);

    scheduler.stop();
    expect(fake.pendingFrames(), "stopped").toBe(0);
    scheduler.start();
    expect(fake.pendingFrames(), "after start").toBe(1);
    scheduler.dispose();
    expect(fake.pendingFrames(), "disposed").toBe(0);
  });

  it("ignores a wake that fires after disposal", () => {
    const fake = fakeFrameDriver();
    const refresh = vi.fn();
    const scheduler = startSceneRefresh(refresh, fake.driver);

    const callback = fake.pendingFrame();
    scheduler.dispose();
    // `cancelFrame` cannot unqueue a callback the browser already holds.
    fake.run(0);
    expect(refresh, "a disposed loop repainted").not.toHaveBeenCalled();
    expect(callback, "the first wake existed").toBeDefined();
  });

  it("drops the intervals it missed after a stall", () => {
    const fake = fakeFrameDriver();
    const refresh = vi.fn();
    const scheduler = startSceneRefresh(refresh, fake.driver);

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
