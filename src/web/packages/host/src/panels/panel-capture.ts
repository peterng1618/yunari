import { findBrowser } from "../serve/display-launcher.js";
import type { PanelGeometry } from "./panel-device.js";
import type { RasterBrowser } from "./panel-raster-browser.js";

export interface PageCaptureDeps {
  /** The one browser every target shares. */
  readonly browserFor: (executable: string) => RasterBrowser;
  /** The browser the launcher was configured with; discovery when absent. */
  readonly browser?: string | undefined;
  readonly isStopping: () => boolean;
}

/**
 * Photographs one player page at `geometry` through the shared browser.
 *
 * A preview opens a target and closes it, so nothing stays running for a theme
 * nobody is showing. The page URL is the caller's: a panel's page names a
 * display, and a thumbnail's page names only the theme.
 */
export function createPageCapture(
  deps: PageCaptureDeps,
): (url: string, geometry: PanelGeometry) => Promise<Uint8Array> {
  return async (url, geometry) => {
    if (deps.isStopping()) throw new Error("The host is shutting down.");

    const executable = deps.browser ?? findBrowser();
    if (executable === undefined) {
      throw new Error(
        "No Chromium-family browser was found, and a preview needs one to render.",
      );
    }

    return await deps.browserFor(executable).capturePage({
      url,
      geometry,
      stillFormat: "png",
    });
  };
}
