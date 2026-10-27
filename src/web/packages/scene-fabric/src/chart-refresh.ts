type FrameDriver = {
  readonly requestFrame: (callback: FrameRequestCallback) => number;
  readonly cancelFrame: (frame: number) => void;
};

const browserFrames: FrameDriver = {
  requestFrame: (callback) => window.requestAnimationFrame(callback),
  cancelFrame: (frame) => window.cancelAnimationFrame(frame),
};

/** The scene's one cadence: fast enough for a transition, bounded for a display. */
const FRAME_INTERVAL_MS = 1_000 / 30;

interface SceneRefreshOptions {
  /** Reports a refresh that threw, once per distinct message. A refresh that
      throws still reschedules, so one bad chart degrades the cadence instead of
      stopping the scene from repainting at all. */
  readonly onError?: (message: string) => void;
}

/**
 * Repaints the scene at 30 fps without changing telemetry cadence.
 *
 * There is no rate to set. A chart asks for its own repaint when its pixels
 * change (0128), and this loop is the ceiling on how often the scene as a whole
 * may be redrawn: a sample pass that finds nothing new does no work, and a
 * minute clock paints once a minute however often this wakes.
 */
export function startSceneRefresh(
  refresh: () => void,
  frames: FrameDriver = browserFrames,
  options: SceneRefreshOptions = {},
): {
  /** Stops repainting until `start()`: the page is going away. */
  stop(): void;
  /** Re-arms a stopped loop. Idempotent, because `pageshow` fires on the first
   *  load as well as on a return from the back/forward cache. */
  start(): void;
  /** Ends the loop for good. `start()` after this does nothing. */
  dispose(): void;
} {
  // The time the next repaint is due, rather than the last one, so a wake that
  // lands between two animation frames keeps the cadence instead of costing one.
  let nextDueMs: number | undefined;
  let frame: number | undefined;
  // Three lifetimes, not two. The page's own (`stop`/`start`) is separate from
  // the editor's, because a page frozen into the back/forward cache comes back
  // — and a loop that could only be stopped came back dead (vg-510).
  let state: "running" | "stopped" | "disposed" = "running";
  // Deduped, because a failing chart would otherwise report every frame.
  const reported = new Set<string>();

  const clearWake = (): void => {
    if (frame !== undefined) frames.cancelFrame(frame);
    frame = undefined;
  };

  const tick = (nowMs: number): void => {
    if (state !== "running") return;
    frame = undefined;
    // The first wake has no due time: refresh immediately, then fall into the
    // cadence from now.
    const due = nextDueMs === undefined || nowMs >= nextDueMs;
    if (nextDueMs === undefined) nextDueMs = nowMs + FRAME_INTERVAL_MS;
    else if (nowMs >= nextDueMs) {
      // A wake late by less than one interval keeps the original cadence, so a
      // due time falling between two 60 Hz frames does not cost a frame. One
      // interval late or more re-anchors — exactly one would otherwise put the
      // next due at `now`, a second repaint on the very next frame — and is
      // also how a stall's backlog is dropped.
      nextDueMs =
        nowMs - nextDueMs >= FRAME_INTERVAL_MS
          ? nowMs + FRAME_INTERVAL_MS
          : nextDueMs + FRAME_INTERVAL_MS;
    }
    // **Scheduled before the refresh, not after.** A refresh that throws would
    // otherwise end the loop, and because every repaint in the scene goes
    // through this one function — charts, bound text, the clock — the whole
    // display would stop updating for good, with only the first failure logged.
    frame = frames.requestFrame(tick);
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
