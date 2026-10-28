import type { PanelDevice, PanelVideoSource } from "./panel-device.js";
import type { Rasterizer } from "./panel-raster.js";

/**
 * One panel's life: open the device, keep a rasteriser pointed at its page, and
 * send a frame only when the pixels would be different.
 *
 * **The scheduler is the interesting half.** A panel is a wall screen with no
 * reader touching it, and every frame costs wire time the machine cannot get
 * back — so a frame nobody would notice is not sent. The comparison is over the
 * encoded image rather than a rendered hash: the encoder is the last step
 * before the wire, so equal bytes are the strongest evidence available that the
 * panel would look the same.
 *
 * **A video theme splits the work in two.** The panel decodes the theme's video
 * itself — the adapter starts it once — and the host sends only the UI, as a
 * PNG with alpha, on the panel's overlay layer. Motion then costs no capture at
 * all, and the cadence above belongs to the sensor readings rather than to the
 * video. A device without that capability, or a video that will not start, is
 * the still path unchanged.
 */

export interface PanelRunnerOptions {
  readonly device: PanelDevice;
  readonly rasterizer: Rasterizer;
  /** How often the page is asked for its current pixels. */
  readonly intervalMs?: number;
  /** Called when a frame the panel did not already hold has been sent. */
  readonly onFrame?: () => void;
  readonly onError?: (message: string) => void;
  /** The assigned theme's video background, when it has one. Only used by a
   *  device that decodes video; ignored otherwise. */
  readonly video?: PanelVideoSource | undefined;
}

export interface PanelRunner {
  /** True when the panel is open and being fed. */
  readonly running: boolean;
  /** How often `tick` should be called. */
  readonly intervalMs: number;
  /** One capture, and one send only if the pixels moved. Answers whether they did. */
  tick(): Promise<boolean>;
  stop(): Promise<void>;
}

/** The panel's refresh cadence. A wall screen costs the machine it reports on. */
export const DEFAULT_PANEL_INTERVAL_MS = 1_000;

export function createPanelRunner(options: PanelRunnerOptions): PanelRunner {
  const intervalMs = options.intervalMs ?? DEFAULT_PANEL_INTERVAL_MS;
  const report = options.onError ?? (() => {});
  let last: Uint8Array | undefined;
  let running = true;
  /** The video this runner may play, dropped once starting it has failed: the
   *  panel then keeps the still path for the rest of this runner's life, and
   *  the owner is told once. */
  let video = options.device.video === undefined ? undefined : options.video;
  let playing = false;
  /** One tick at a time: a capture plus a slow send outlives the interval, and
   *  two transfers on one USB device cancel each other. */
  let ticking = false;

  const startVideo = async (source: PanelVideoSource): Promise<boolean> => {
    const capability = options.device.video;

    if (capability === undefined) return false;

    try {
      await capability.start(source.bytes, source.placement);
      playing = true;
      return true;
    } catch (error) {
      report(`video: ${exactly(error)}`);
      return false;
    }
  };

  const captureAndSend = async (): Promise<boolean> => {
    if (video !== undefined && options.device.video !== undefined) {
      if (!playing && !(await startVideo(video))) {
        // Not playing and not recoverable: a still frame is honest, and the
        // failure was reported above rather than repeated every second.
        video = undefined;
      } else {
        return sendOverlay();
      }
    }

    return sendStill();
  };

  const sendOverlay = async (): Promise<boolean> => {
    let png: Uint8Array;
    try {
      png = await options.rasterizer.captureOverlay();
    } catch (error) {
      report(`capture: ${exactly(error)}`);
      return false;
    }

    if (last !== undefined && sameBytes(last, png)) return false;

    try {
      await options.device.video?.presentOverlay(png);
    } catch (error) {
      report(`overlay: ${exactly(error)}`);
      return false;
    }

    last = png;
    options.onFrame?.();
    return true;
  };

  const sendStill = async (): Promise<boolean> => {
    let jpeg: Uint8Array;
    try {
      jpeg = await options.rasterizer.capture();
    } catch (error) {
      // The stage is named: a capture failure is the browser, a send failure
      // is the wire, and "Cancelled" alone cannot tell an owner which.
      report(`capture: ${exactly(error)}`);
      return false;
    }

    // A frame identical to the one already on the panel is a frame that
    // changes nothing. The comparison is on the bytes the wire would carry,
    // so a capture that differs only in rounding noise still counts as a
    // change — the honest choice, because that noise is real pixels.
    if (last !== undefined && sameBytes(last, jpeg)) return false;

    try {
      await options.device.present(jpeg);
    } catch (error) {
      // A send that failed did not put these pixels on the panel, so the last
      // frame is not this one: keeping it would suppress the retry.
      report(`send: ${exactly(error)}`);
      return false;
    }

    last = jpeg;
    options.onFrame?.();
    return true;
  };

  return {
    get running(): boolean {
      return running;
    },

    intervalMs,

    async tick(): Promise<boolean> {
      if (!running) return false;
      if (ticking) return false;

      ticking = true;
      try {
        return await captureAndSend();
      } finally {
        ticking = false;
      }
    },

    async stop(): Promise<void> {
      if (!running) return;
      running = false;

      // The video is the panel's own playback; leaving it running would keep a
      // removed display looping. Its failure is not worth blocking the close.
      if (playing) {
        await options.device.video?.stop().catch(() => undefined);
      }

      await options.rasterizer.close();
      await options.device.close();
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
