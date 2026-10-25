export type ChartRefreshRate = 1 | 30;

type FrameDriver = {
  readonly requestFrame: (callback: FrameRequestCallback) => number;
  readonly cancelFrame: (frame: number) => void;
  /** Wakes the loop without a browser frame, so the 1 fps cadence sleeps
      instead of requesting a frame every 16 ms and discarding it. */
  readonly setTimer: (callback: () => void, delayMs: number) => number;
  readonly clearTimer: (id: number) => void;
};

const browserFrames: FrameDriver = {
  requestFrame: (callback) => window.requestAnimationFrame(callback),
  cancelFrame: (frame) => window.cancelAnimationFrame(frame),
  setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimer: (id) => window.clearTimeout(id),
};

interface ChartRefreshOptions {
  /** Reports a refresh that threw, once per distinct message. A refresh that
      throws still reschedules, so one bad chart degrades the cadence instead of
      stopping the scene from repainting at all. */
  readonly onError?: (message: string) => void;
}

/** Repaints charts at a capped browser-frame rate without changing telemetry cadence. */
export function startChartRefresh(
  refresh: () => void,
  initialRate: ChartRefreshRate,
  frames: FrameDriver = browserFrames,
  options: ChartRefreshOptions = {},
): {
  setRate(rate: ChartRefreshRate): void;
  /** Stops repainting until `start()`: the page is going away. */
  stop(): void;
  /** Re-arms a stopped loop. Idempotent, because `pageshow` fires on the first
   *  load as well as on a return from the back/forward cache. */
  start(): void;
  /** Ends the loop for good. `start()` after this does nothing. */
  dispose(): void;
} {
  let rate = initialRate;
  // The time the next repaint is due, rather than the last one: at 1 fps the
  // loop has to know how long it may sleep before asking for a frame at all.
  let nextDueMs: number | undefined;
  let frame: number | undefined;
  let timer: number | undefined;
  // Three lifetimes, not two. The page's own (`stop`/`start`) is separate from
  // the editor's, because a page frozen into the back/forward cache comes back
  // — and a loop that could only be stopped came back dead (vg-510).
  let state: "running" | "stopped" | "disposed" = "running";
  // Deduped, because a failing chart would otherwise report every frame.
  const reported = new Set<string>();

  const clearWake = (): void => {
    if (frame !== undefined) frames.cancelFrame(frame);
    frame = undefined;
    if (timer !== undefined) frames.clearTimer(timer);
    timer = undefined;
  };

  // Exactly one wake at a time. At 30 fps that is a frame; at 1 fps it is a
  // timer for the remainder, because a frame requested only to be discarded
  // costs the same repaint budget as one that paints.
  const armWake = (nowMs: number): void => {
    if (rate === 1 && nextDueMs !== undefined) {
      timer = frames.setTimer(
        () => {
          timer = undefined;
          if (state !== "running") return;
          frame = frames.requestFrame(tick);
        },
        Math.max(0, nextDueMs - nowMs),
      );
      return;
    }
    frame = frames.requestFrame(tick);
  };

  const tick = (nowMs: number): void => {
    if (state !== "running") return;
    frame = undefined;
    // The first wake has no due time: refresh immediately, then fall into the
    // cadence from now.
    const due = nextDueMs === undefined || nowMs >= nextDueMs;
    if (nextDueMs === undefined) nextDueMs = nowMs + 1_000 / rate;
    else if (nowMs >= nextDueMs) nextDueMs += 1_000 / rate;
    // **Scheduled before the refresh, not after.** A refresh that throws would
    // otherwise end the loop, and because every repaint in the scene goes
    // through this one function — charts, bound text, the clock — the whole
    // display would stop updating for good, with only the first failure logged.
    armWake(nowMs);
    if (!due) return;
    try {
      refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (reported.has(message)) return;
      reported.add(message);
      options.onError?.(
        `A repaint failed and was skipped; the scene keeps updating. ${message}`,
      );
    }
  };

  frame = frames.requestFrame(tick);

  return {
    setRate(nextRate: ChartRefreshRate): void {
      rate = nextRate;
    },
    stop(): void {
      if (state !== "running") return;
      state = "stopped";
      clearWake();
    },
    start(): void {
      if (state !== "stopped") return;
      state = "running";
      // A frame re-arms from a fresh `now`, so time spent in the back/forward
      // cache does not delay the next repaint.
      frame = frames.requestFrame(tick);
    },
    dispose(): void {
      state = "disposed";
      clearWake();
    },
  };
}
