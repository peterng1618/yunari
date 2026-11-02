import {
  BACKGROUND_MEDIA_DEFAULTS,
  type GlassSampling,
  MAX_BACKGROUND_OFFSET,
  MAX_BACKGROUND_SCALE,
  MIN_BACKGROUND_OFFSET,
  MIN_BACKGROUND_SCALE,
} from "@yunari/renderer-core";

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

/** The media geometry the page's own cover fit will apply, so the host can
 *  encode enough pixels for the box those two steps leave behind. */
export interface PanelBackgroundGeometry {
  readonly offsetX?: number;
  readonly offsetY?: number;
  readonly scale?: number;
}

function bounded(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * The host's derived media for this panel, or nothing for a browser display.
 *
 * `clip=1` means the device decodes the theme clip itself, so the page never
 * shows the picture: one poster frame is all its glass can sample. Without it
 * the device shows the page, so the page asks for the clip scaled to the pixels
 * the page's cover fit, pan and zoom will paint. Asking for the plain viewport
 * left the page magnifying a smaller copy and looked soft. Either way the
 * theme's full-size source is never fetched.
 */
export function panelBackgroundSource(
  search: string,
  themeId: string,
  viewport: { readonly width: number; readonly height: number },
  media: PanelBackgroundGeometry = {},
): PanelBackgroundSource | undefined {
  const parameters = new URLSearchParams(search);
  if (parameters.get("panel") !== "1") return undefined;

  const path = `/api/themes/${encodeURIComponent(themeId)}`;
  if (parameters.get("clip") === "1") {
    return { url: `${path}/poster`, kind: "image" };
  }

  // A pan of |o|·box needs that much overhang on its axis, and zoom grows the
  // painted rect further; the host's cover copy must satisfy both to stay 1:1.
  const offsetX = bounded(
    media.offsetX,
    BACKGROUND_MEDIA_DEFAULTS.offsetX,
    MIN_BACKGROUND_OFFSET,
    MAX_BACKGROUND_OFFSET,
  );
  const offsetY = bounded(
    media.offsetY,
    BACKGROUND_MEDIA_DEFAULTS.offsetY,
    MIN_BACKGROUND_OFFSET,
    MAX_BACKGROUND_OFFSET,
  );
  const scale = bounded(
    media.scale,
    BACKGROUND_MEDIA_DEFAULTS.scale,
    MIN_BACKGROUND_SCALE,
    MAX_BACKGROUND_SCALE,
  );
  const edge = (value: number): number =>
    Math.min(MAX_PANEL_EDGE, Math.max(1, Math.floor(value) || 1));
  const width = viewport.width * (1 + 2 * Math.abs(offsetX)) * scale;
  const height = viewport.height * (1 + 2 * Math.abs(offsetY)) * scale;
  return {
    url: `${path}/panel-video?width=${edge(width)}&height=${edge(height)}`,
    kind: "video",
  };
}
