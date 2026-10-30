import type { PanelDevice, PanelVideoSource } from "./panel-device.js";
import type { Rasterizer } from "./panel-raster.js";

/**
 * One panel's life: open the device, keep a rasteriser pointed at its page, and
 * send a frame only when the pixels would be different.
 *
 * **The scheduler is the interesting half.** A panel is a wall screen with no
 * reader touching it, and every frame costs wire time the machine cannot get
 * back — so a frame nobody would notice is not sent. The comparison is over the
 * encoded JPEG rather than a rendered hash: the encoder is the last step before
 * the wire, so equal bytes are the strongest evidence available that the panel
 * would look the same.
 *
 * That also makes the interesting case cheap: a theme whose readings have not
 * moved captures, compares and stops, and the capture is the only cost.
 *
 * **A theme with a video background is the device's job, not the host's.** The
 * clip is uploaded once and the device plays it; each tick then sends only the
 * UI, with the theme's background hidden, so the wire carries the change a
 * viewer would notice rather than every frame of a video the panel already has.
 */

export interface PanelRunnerOptions {
  readonly device: PanelDevice;
  readonly rasterizer: Rasterizer;
  /** How often the page is asked for its current pixels. */
  readonly intervalMs?: number;
  /** Called when a frame the panel did not already hold has been sent. */
  readonly onFrame?: () => void;
  readonly onError?: (message: string) => void;
  /**
   * A clip the device plays itself, when its theme has a video background.
   * The runner then sends the UI alone over it; no source keeps the still
   * path unchanged.
   */
  readonly video?: PanelVideoSource | undefined;
  /**
   * Called once when the device has refused three frames in a row — a lost
   * port, an unplugged cable, a re-enumerated interface. The runner stops
   * feeding itself; reopening is the manager's, because only it can start a
   * new runner and a new page.
   */
  readonly onLost?: (message: string) => void;
}

export interface PanelRunner {
  /** True when the panel is open and being fed. */
  readonly running: boolean;
  /** How often `tick` should be called. */
  readonly intervalMs: number;
  /**
   * One capture, and one send only if the pixels moved. Answers whether a frame
   * went out; a tick that found the previous one still running is skipped and
   * answers `false` without starting a second capture.
   */
  tick(): Promise<boolean>;
  stop(): Promise<void>;
}

/** The panel's refresh cadence. A wall screen costs the machine it reports on. */
export const DEFAULT_PANEL_INTERVAL_MS = 1_000;

/**
 * Consecutive failures that mean the device is gone rather than one bad frame.
 *
 * A lost port fails every write, so three ticks (about 3 s at the default
 * cadence) is long enough to outlast a single hiccup and short enough that the
 * owner sees the panel come back soon after the manager's retry pass.
 */
const FAILURES_BEFORE_LOST = 3;

export function createPanelRunner(options: PanelRunnerOptions): PanelRunner {
  const intervalMs = options.intervalMs ?? DEFAULT_PANEL_INTERVAL_MS;
  const report = options.onError ?? (() => {});
  let last: Uint8Array | undefined;
  /** True while ticks are allowed; cleared the moment a stop is asked for. */
  let running = true;
  /** True once the device actually closed, so a failed close can be retried. */
  let closed = false;
  /** The stop in flight; concurrent callers share one attempt. */
  let stopping: Promise<void> | undefined;
  /** The tick in flight, so a stop can wait for it before closing the device. */
  let inFlight: Promise<boolean> | undefined;
  /** Not yet uploaded; dropped once the device has seen it or refused it. */
  let source = options.video;
  /** The device is playing the clip, so stop releases it. */
  let playing = false;
  /** Set once the clip was stopped, so a retried stop does not ask twice. */
  let clipStopped = false;
  /** The overlay path still works; a refused overlay drops the panel to stills. */
  let overlay = false;
  /** Consecutive failed captures or sends; a success clears the count. */
  let failures = 0;
  /** The device was given up on, so no further tick may read or write it. */
  let lost = false;
  /** A capture started ahead of the send, so the next tick does not pay it. */
  let ahead:
    | { readonly overlay: boolean; readonly frame: Promise<Uint8Array> }
    | undefined;
  /** The timer fired mid-tick; one follow-up runs when that tick settles. */
  let queued = false;

  /**
   * Counts one failed capture or send, and gives the device up after the
   * threshold. `onLost` runs once; the message is the failure that tripped it,
   * so the manager's log names the cause rather than a status sentence.
   */
  const failed = (error: unknown): void => {
    report(exactly(error));
    failures += 1;
    if (lost || failures < FAILURES_BEFORE_LOST) return;

    lost = true;
    // The same flag a stop clears, so a status read answers "not connected"
    // before the manager's detach lands rather than after it.
    running = false;
    options.onLost?.(exactly(error));
  };

  const captureFor = (useOverlay: boolean): Promise<Uint8Array> =>
    useOverlay
      ? options.rasterizer.captureOverlay()
      : options.rasterizer.capture();

  /** The prefetched capture when it matches this path, else a fresh one. */
  const takeCapture = (useOverlay: boolean): Promise<Uint8Array> => {
    if (ahead !== undefined && ahead.overlay === useOverlay) {
      const { frame } = ahead;
      ahead = undefined;
      return frame;
    }

    return captureFor(useOverlay);
  };

  /**
   * Starts the next capture while this frame is still on the wire.
   *
   * A capture costs about what a send costs, so running them one after the
   * other halves the panel's rate; overlapping them makes a frame cost the
   * longer of the two. Only one capture is ever in flight: a prefetch is
   * started only when none is pending, and a change of path (the overlay
   * fallback) leaves the stale one to be dropped.
   */
  const prefetch = (useOverlay: boolean): void => {
    if (ahead !== undefined || !running || lost) return;

    // A synchronous refusal ("the rasteriser is closed") and an asynchronous
    // one are both the next tick's to report: a prefetched capture nobody
    // consumes must not surface as an unhandled rejection.
    const frame = Promise.resolve().then(() => captureFor(useOverlay));
    frame.catch(() => {});
    ahead = { overlay: useOverlay, frame };
  };

  /**
   * One capture and one send, if the pixels moved.
   *
   * A frame identical to the one already on the panel is a frame that changes
   * nothing. The comparison is on the bytes the wire would carry, so a capture
   * that differs only in rounding noise still counts as a change — the honest
   * choice, because that noise is real pixels.
   */
  const send = async (
    useOverlay: boolean,
    present: (frame: Uint8Array) => Promise<void>,
    presentFailed?: () => void,
  ): Promise<boolean> => {
    let frame: Uint8Array;

    try {
      frame = await takeCapture(useOverlay);
    } catch (error) {
      failed(error);
      return false;
    }

    // Before the send, not after it: this is the overlap.
    prefetch(useOverlay);

    if (last !== undefined && sameBytes(last, frame)) return false;

    try {
      await present(frame);
    } catch (error) {
      // A send that failed did not put these pixels on the panel, so the last
      // frame is not this one: keeping it would suppress the retry.
      failed(error);
      presentFailed?.();
      return false;
    }

    failures = 0;
    last = frame;
    options.onFrame?.();
    return true;
  };

  const runTick = async (): Promise<boolean> => {
    const video = options.device.video;

    if (source !== undefined && video !== undefined) {
      try {
        await video.start(source.bytes, source.placement);
        playing = true;
        overlay = true;
      } catch (error) {
        // A clip this device will not play is a mode it does not have: the
        // panel falls back to stills for the rest of its life rather than
        // retrying an upload that already failed.
        report(exactly(error));
      }

      // Started or refused, the upload is not repeated.
      source = undefined;
    }

    if (overlay && video !== undefined) {
      return await send(
        true,
        (frame) => video.presentOverlay(frame),
        () => {
          // An overlay the device will not take is a video mode it cannot
          // compose. Stills are the honest fallback, and the clip keeps playing
          // underneath until stop releases it.
          overlay = false;
        },
      );
    }

    return await send(false, (frame) => options.device.present(frame));
  };

  const tickOnce = (): Promise<boolean> => {
    // A tick asked for after the stop began must not open a capture: the
    // device is on its way to closed. Neither may one after the device was
    // given up on: the manager is already tearing this runner down.
    if (!running || lost) return Promise.resolve(false);
    // A capture that is slow enough to still be running when the timer fires
    // again is not a reason to start a second one: two sends racing for the
    // same wire is worse than a skipped frame. The tick it displaced is not
    // dropped either — one follow-up runs as soon as this one settles, which
    // is what keeps a slow panel at its own rate instead of the timer's.
    if (inFlight !== undefined) {
      queued = true;
      return Promise.resolve(false);
    }

    const tick = runTick().finally(() => {
      if (inFlight === tick) inFlight = undefined;
      if (!queued) return;
      queued = false;
      void tickOnce();
    });
    inFlight = tick;
    return tick;
  };

  return {
    get running(): boolean {
      return running;
    },

    intervalMs,

    tick: tickOnce,

    stop(): Promise<void> {
      running = false;
      if (stopping !== undefined) return stopping;
      if (closed) return Promise.resolve();

      const attempt = (async () => {
        // A tick already inside `video.start` or a capture must finish first:
        // closing the port under it would make the start fail against a dead
        // device, and its result could land after this stop read it.
        await inFlight;
        // A prefetched capture is a request inside the rasteriser: closing it
        // now would answer that request with an error nobody is waiting for.
        await ahead?.frame.catch(() => {});
        ahead = undefined;

        // The clip belongs to the device once started, so it is stopped with
        // it rather than left playing behind a port the next runner wants.
        if (playing && !clipStopped) {
          await options.device.video?.stop();
          clipStopped = true;
        }

        await options.rasterizer.close();
        await options.device.close();
        closed = true;
      })().finally(() => {
        if (stopping === attempt) stopping = undefined;
      });

      stopping = attempt;
      return attempt;
    },
  };
}

function exactly(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameBytes(first: Uint8Array, second: Uint8Array): boolean {
  if (first.length !== second.length) return false;

  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false;
  }

  return true;
}
