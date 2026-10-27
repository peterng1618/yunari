import type { PanelDevice, PanelGeometry } from "./panel-device.js";
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
 */

export interface PanelRunnerOptions {
  readonly device: PanelDevice;
  readonly rasterizer: Rasterizer;
  /** How often the page is asked for its current pixels. */
  readonly intervalMs?: number;
  /** Called when a frame the panel did not already hold has been sent. */
  readonly onFrame?: () => void;
  readonly onError?: (message: string) => void;
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

  return {
    get running(): boolean {
      return running;
    },

    intervalMs,

    async tick(): Promise<boolean> {
      if (!running) return false;

      let jpeg: Uint8Array;
      try {
        jpeg = await options.rasterizer.capture();
      } catch (error) {
        report(exactly(error));
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
        report(exactly(error));
        return false;
      }

      last = jpeg;
      options.onFrame?.();
      return true;
    },

    async stop(): Promise<void> {
      if (!running) return;
      running = false;

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

/** A panel's own name for itself, for a log line that names which one failed. */
export function describePanel(geometry: PanelGeometry): string {
  return `${geometry.width}x${geometry.height}`;
}
