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
