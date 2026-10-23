import { createCanvas } from "canvas";

/**
 * The authored glass scene the browser proof renders.
 *
 * **Only the editor mount uses this.** The player would load the same envelope
 * through the host, but its background media 404s there - the resolver and the
 * host's asset route disagree about the `assets/` prefix, recorded in
 * [issue #3](https://github.com/peterng1618/yunari/issues/3) - so the player's media
 * path has no end-to-end proof yet. There is no player spec for this fixture and
 * this header used to claim otherwise.
 *
 * **The media is the only backdrop, and nothing opaque is drawn over it.** A
 * first version put 160 opaque bars in the scene as texture; they hid the media
 * layer completely, so the panel sampled bars and the media-offset claim had
 * nothing to measure. The media image now carries the high-frequency texture
 * itself, so one source answers both questions: is the backdrop softened, and
 * does the panel show the part of the media behind it.
 *
 * The artboard is 4:3, so the media layer does carry a real offset - but in the
 * editor's stage it is **vertical only**, and a vertical stripe cannot detect a
 * horizontal misplacement. What this fixture pins for placement is therefore the
 * layer's scale and vertical position; the horizontal `deviceLeft` term is
 * pinned arithmetically only, because both mounts happen to put the layer at
 * `left = 0`. That gap rides with the bug's pickup action.
 *
 * No foreground **text**: this container has no usable font and renders
 * "FROST" as a placeholder dash, so the sharp-foreground claim is not
 * measurable here. That half is Task 11's, where font work is already in
 * scope.
 */

export const GLASS_ARTBOARD = { width: 640, height: 480 } as const;
export const GLASS_PANEL = {
  left: 300,
  top: 120,
  width: 240,
  height: 160,
  radius: 24,
  blurRadius: 16,
} as const;

/** The selectable, untreated panel the authoring test drives the control on. */
export const AUTHORING_PANEL_ID = "authoring";

export const GLASS_MEDIA_SOURCE = { width: 800, height: 450 } as const;
export const GLASS_STRIPE_SOURCE_X = 440;
export const GLASS_STRIPE_SOURCE_WIDTH = 120;

/** The letterbox bar the glass fixtures paint an artboard's edge with — a
 *  document colour, so it belongs to the fixture. Every glass spec's `palette`
 *  entry and the shared envelope read it here rather than each spelling it. */
export const GLASS_BAR = "#101318";

/** Every 64 source px - about 50 device px, well past twice the blur radius. The
 *  bars therefore flatten out under a real blur while a tint leaves them
 *  intact, and the marker is left as the only feature in the band, so a
 *  measurement of it is measuring the blur rather than the bar pattern. */
const MEDIA_BAR_PITCH = 64;

/**
 * PNG, not SVG: a packaged SVG is served as an opaque byte stream and an
 * `<img>` will not decode it, so there would be nothing to sample.
 */
export function glassStripesPng(): Uint8Array {
  const surface = createCanvas(
    GLASS_MEDIA_SOURCE.width,
    GLASS_MEDIA_SOURCE.height,
  );
  const context = surface.getContext("2d");
  for (let x = 0; x < surface.width; x += MEDIA_BAR_PITCH * 2) {
    context.fillStyle = "#e4e4e4";
    context.fillRect(x, 0, MEDIA_BAR_PITCH, surface.height);
    context.fillStyle = "#3a3a3a";
    context.fillRect(x + MEDIA_BAR_PITCH, 0, MEDIA_BAR_PITCH, surface.height);
  }
  // The marker: wide and dark, so a blur preserves its centre exactly.
  context.fillStyle = "#000000";
  context.fillRect(
    GLASS_STRIPE_SOURCE_X,
    0,
    GLASS_STRIPE_SOURCE_WIDTH,
    surface.height,
  );
  return surface.toBuffer("image/png");
}

export const GLASS_ENVELOPE = {
  schemaVersion: 2 as const,
  fabricVersion: "7.4.0" as const,
  id: "e2e-glass",
  metadata: { name: "E2E glass", themeLanguage: "en" },
  artboard: {
    width: GLASS_ARTBOARD.width,
    height: GLASS_ARTBOARD.height,
    contentFit: "contain" as const,
  },
  // Transparent, or the background paint would hide the media layer the glass
  // has to sample, on screen and in the sampled region alike.
  background: {
    color: { ref: "palette.none" as const },
    media: { assetId: "stripes", bounds: "theme" as const },
  },
  globals: {
    palette: {
      none: {
        name: "None",
        value: { kind: "solid" as const, color: "transparent" },
      },
      bar: { name: "Bar", value: { kind: "solid" as const, color: GLASS_BAR } },
      panel: {
        name: "Panel",
        value: { kind: "solid" as const, color: "rgba(255, 255, 255, 0.10)" },
      },
      edge: {
        name: "Edge",
        value: { kind: "solid" as const, color: "rgba(255, 255, 255, 0.35)" },
      },
    },
  },
  assets: [
    {
      id: "stripes",
      kind: "image" as const,
      path: "assets/stripes.png",
      license: { name: "MIT", attribution: "Yunari test fixture." },
    },
  ],
  scene: {
    version: "7.4.0",
    objects: [
      {
        type: "Rect",
        version: "7.4.0",
        originX: "left",
        originY: "top",
        left: GLASS_PANEL.left,
        top: GLASS_PANEL.top,
        width: GLASS_PANEL.width,
        height: GLASS_PANEL.height,
        rx: GLASS_PANEL.radius,
        ry: GLASS_PANEL.radius,
        fill: "rgba(255, 255, 255, 0.10)",
        stroke: "rgba(255, 255, 255, 0.35)",
        strokeWidth: 2,
        id: "glass",
        selectable: false,
        evented: false,
        yunariPaint: { fill: "palette.panel", stroke: "palette.edge" },
        yunariGlass: { blurRadius: GLASS_PANEL.blurRadius },
      },
      {
        // No treatment: the control that proves an ordinary panel is untouched.
        // Selectable, so the authoring test can group it with the panel it
        // gives a treatment to — a grouped panel is a real authoring operation
        // and has to be measurable, not skipped.
        type: "Rect",
        version: "7.4.0",
        originX: "left",
        originY: "top",
        left: 40,
        top: 210,
        width: 200,
        height: 80,
        rx: 12,
        ry: 12,
        fill: "rgba(255, 255, 255, 0.10)",
        id: "plain",
        yunariPaint: { fill: "palette.panel" },
      },
      {
        /**
         * The panel the **authoring** test drives. `plain` above is deliberately
         * inert, and a control nobody can select is precisely the operation the
         * glass control has to be proved on, so this one is selectable and
         * carries no treatment to start from.
         */
        type: "Rect",
        version: "7.4.0",
        originX: "left",
        originY: "top",
        left: 40,
        top: 300,
        width: 200,
        height: 80,
        rx: 12,
        ry: 12,
        fill: "rgba(255, 255, 255, 0.10)",
        id: AUTHORING_PANEL_ID,
        yunariPaint: { fill: "palette.panel" },
      },
    ],
  },
};
