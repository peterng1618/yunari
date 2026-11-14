import type {
  PanelDevice,
  PanelFamily,
  PanelOpenOptions,
  PanelVideoSource,
} from "./panel-device.js";
import type { Rasterizer } from "./panel-raster.js";
import type { RasterBrowser } from "./panel-raster-browser.js";
import {
  openPanelWorker,
  type PanelWorker,
  type PanelWorkerOptions,
} from "./panel-worker-client.js";

/**
 * One panel, opened: its device, the clip it plays, and the page that draws it.
 *
 * **The order is the contract.** The device states its geometry, its still
 * encoding and whether it takes video, so it opens first; the clip is read next,
 * because a theme with a video is a page standing on one poster frame instead of
 * playing it; the page is opened last, because its URL depends on the clip.
 * Every failure releases the device it opened, so a panel that cannot be drawn
 * is not a panel left holding its port.
 *
 * **A built-in family's device and page live on their own thread.** Its driver
 * waits synchronously on a HID control transfer and decodes a frame before the
 * wire sees it, so run on the host's loop one panel's frame delays the others;
 * a plugin's device is already off this loop in the supervisor's child. The
 * decision and its measurements are `docs/decisions/0136`.
 */

export interface PanelSessionOptions {
  readonly family: PanelFamily;
  /** Whether this row is one the host ships, so it opens on a thread. */
  readonly builtin: boolean;
  readonly open: PanelOpenOptions;
  /** The page for a display; `clip` says the device plays its own video. */
  readonly pageFor: (clip: boolean) => string;
  /** The clip this display's theme plays itself, or undefined for a still. A
   *  read that fails is a still panel, not a failed one. */
  readonly videoFor?: () => Promise<PanelVideoSource | undefined>;
  readonly browser: RasterBrowser;
  readonly workerFactory?: (
    options: PanelWorkerOptions,
  ) => Promise<PanelWorker>;
  /** Called with a clip that could not be read; the panel carries on. */
  readonly report: (message: string) => void;
}

export interface PanelSession {
  readonly device: PanelDevice;
  readonly rasterizer: Rasterizer;
  readonly video: PanelVideoSource | undefined;
}

export async function openPanelSession(
  options: PanelSessionOptions,
): Promise<PanelSession> {
  const worker = options.builtin
    ? await (options.workerFactory ?? openPanelWorker)({
        vendorId: options.family.vendorId,
        productId: options.family.productId,
        open: options.open,
      })
    : undefined;

  const device = worker?.device ?? (await options.family.open(options.open));

  let video: PanelVideoSource | undefined;

  if (device.video !== undefined && options.videoFor !== undefined) {
    try {
      video = await options.videoFor();
    } catch (error) {
      options.report(error instanceof Error ? error.message : String(error));
    }
  }

  const url = options.pageFor(video !== undefined);

  const openPage = async (): Promise<Rasterizer> => {
    if (worker === undefined) {
      return await options.browser.create({
        url,
        geometry: device.geometry,
        // The device says which still it consumes; a panel that decodes to raw
        // pixels takes PNG rather than paying for a lossy intermediate.
        ...(device.stillFormat === undefined
          ? {}
          : { stillFormat: device.stillFormat }),
      });
    }

    // The host keeps the browser and opens the target; the thread drives the
    // page. The lease is what tells the browser this page is in use, so its
    // idle stop cannot close the runtime under a running panel.
    const lease = await options.browser.leasePage();

    try {
      return await worker.attach({
        pageUrl: lease.pageUrl,
        url,
        closePage: () => lease.close(),
      });
    } catch (error) {
      await lease.close().catch(() => {});
      throw error;
    }
  };

  try {
    return { device, video, rasterizer: await openPage() };
  } catch (error) {
    await device.close();
    throw error;
  }
}
