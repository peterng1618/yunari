import type { GlassSampling } from "@yunari/renderer-core";

/**
 * The picture a page's glass panels sample when their treatment declares none.
 *
 * A hardware panel is served this same player with `?panel=1` (`panels/panel-page`
 * in the host). It renders a still-headed composition and never shows the live
 * frames a `"dynamic"` sample would follow, so it is served the declared still
 * instead — and a video with no declared frame stands on its first frame
 * (`background-media`). A browser display has no flag and keeps the live
 * default.
 */
export function panelGlassSampling(search: string): GlassSampling | undefined {
  return new URLSearchParams(search).get("panel") === "1"
    ? "static"
    : undefined;
}

/** What a panel's page loads in place of the theme's video background. */
export interface PanelBackgroundSource {
  readonly url: string;
  readonly kind: "image" | "video";
}

/** The largest panel a clip is scaled for, matching the video envelope. */
const MAX_PANEL_EDGE = 4096;

/**
 * The host's derived media for this panel, or nothing for a browser display.
 *
 * `clip=1` means the device decodes the theme clip itself, so the page never
 * shows the picture: one poster frame is all its glass can sample. Without it
 * the device shows the page, so the page asks for the clip painted into the
 * theme's own media box. The host bakes the authored pan and zoom into those
 * pixels; the page displays the clip 1:1. Asking for the viewport with the
 * geometry still to apply left the page magnifying a pre-zoom copy and decoding
 * several times the panel's pixels.
 */
export function panelBackgroundSource(
  search: string,
  themeId: string,
  viewport: { readonly width: number; readonly height: number },
): PanelBackgroundSource | undefined {
  const parameters = new URLSearchParams(search);
  if (parameters.get("panel") !== "1") return undefined;

  const path = `/api/themes/${encodeURIComponent(themeId)}`;
  if (parameters.get("clip") === "1") {
    return { url: `${path}/poster`, kind: "image" };
  }

  const edge = (value: number): number =>
    Math.min(MAX_PANEL_EDGE, Math.max(1, Math.floor(value) || 1));
  return {
    url: `${path}/panel-video?width=${edge(viewport.width)}&height=${edge(viewport.height)}`,
    kind: "video",
  };
}
