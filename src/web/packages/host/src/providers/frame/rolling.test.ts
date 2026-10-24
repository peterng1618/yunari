import { describe, expect, it } from "vitest";
import { FrameWindow } from "./rolling.js";

function framesAt(
  window: FrameWindow,
  count: number,
  frametimeMs: number,
  startMs = 0,
): void {
  for (let i = 0; i < count; i += 1) {
    window.add(frametimeMs, startMs + i);
  }
}

describe("FrameWindow.fps", () => {
  it("is undefined with no frames, and never zero", () => {
    expect(new FrameWindow().fps(0)).toBeUndefined();
  });

  it("is the reciprocal of the mean frametime over the last second", () => {
    const window = new FrameWindow();
    window.add(5, 0);
    window.add(10, 500);
    window.add(15, 1_000);

    // All three are inside 0..1000; mean 10 ms -> 100 FPS.
    expect(window.fps(1_000)).toBeCloseTo(100, 9);
  });

  it("drops a frame older than one second", () => {
    const window = new FrameWindow();
    window.add(5, 0);
    window.add(20, 800);

    // At 1000 the frame at 0 is exactly one second old and still counts;
    // at 1801 it has aged out, leaving only the 20 ms frame.
    expect(window.fps(1_000)).toBeCloseTo(80, 9);
    expect(window.fps(1_800)).toBeCloseTo(50, 9);
  });

  it("ignores a frametime that is not positive and finite", () => {
    const window = new FrameWindow();
    window.add(0, 0);
    window.add(-4, 1);
    window.add(Number.NaN, 2);
    window.add(Number.POSITIVE_INFINITY, 3);

    expect(window.fps(3)).toBeUndefined();
  });
});

describe("FrameWindow.low1", () => {
  it("is undefined below 1000 frames in the window", () => {
    const window = new FrameWindow();
    framesAt(window, 999, 5);

    expect(window.low1(998)).toBeUndefined();
  });

  it("averages the slowest 1% frametimes and converts that mean to FPS", () => {
    const window = new FrameWindow();
    // 990 fast frames and ten slow ones: five at 100 ms, five at 200 ms.
    framesAt(window, 990, 5);
    framesAt(window, 5, 100, 1_000);
    framesAt(window, 5, 200, 2_000);

    // ceil(1% of 1000) = 10 slowest frames; mean frametime 150 ms.
    // 1000 / 150 FPS. Averaging per-frame FPS instead would give 7.5 FPS,
    // so this fixture distinguishes the two readings.
    expect(window.low1(3_000)).toBeCloseTo(1000 / 150, 9);
    expect(window.low1(3_000)).not.toBeCloseTo(7.5, 3);
  });

  it("drops frames once they are older than 60 seconds", () => {
    const window = new FrameWindow();
    framesAt(window, 1_000, 5);

    // The oldest is exactly 60 s old at 60000 and still inside.
    expect(window.low1(60_000)).toBeCloseTo(200, 9);
    // One more millisecond pushes it out, leaving 999 frames: not a 1% low.
    expect(window.low1(60_001)).toBeUndefined();
  });
});
