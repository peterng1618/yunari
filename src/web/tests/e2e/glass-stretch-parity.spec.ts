import { expect, test } from "@playwright/test";
import { writeThemePackage } from "@yunari/theme-package";
import { GLASS_ENVELOPE, glassStripesPng } from "./glass-fixture.js";
import { assertBlur, readGlass } from "./glass-probe.js";
import { openThemeFromStore, storedThemeOfPackage } from "./store-library.js";

/**
 * The browser proof that a panel's **own scale** decides how far it diffuses,
 * and that stretching it one way is the same as stretching it the other.
 *
 * `glass.dom.test.ts` pins the number the radius is multiplied by, through a
 * stubbed context — and `node-canvas` accepts `ctx.filter` and ignores it, so
 * nothing there can show that a blur happened. `vg-515` is a claim about what
 * the browser renders: two panels of the **same area** at the **same authored
 * value**, one stretched 4x horizontally and one 4x vertically, must diffuse the
 * backdrop by the same amount. Before the ruling the radius followed `scaleX`
 * alone, so the first blurred four times as far as the second.
 *
 * **The statistic is the stripe pattern's own contrast.** The backdrop is the
 * glass fixture's 64 source px bars, which are uniform across the media — so two
 * different bands inside the same artboard carry the same pattern, and a
 * column-mean profile's peak adjacent-column step reads the diffusion directly.
 * A wider blur flattens the bars further, and Gaussian diffusion attenuates a
 * pitch-`p` pattern by `exp(-2π²σ²/p²)`, so the two readings are equal exactly
 * when the two σ are.
 *
 * **The bars are the whole comparison, and the fixture's dark marker is
 * avoided.** The marker is one wide black bar at a known source x; a band that
 * covered it would read the marker's own edge rather than the pattern, and the
 * two bands are at different artboard x, so both windows are placed clear of it
 * (artboard x 352-448 at this media scale).
 */

/** The authored value: the diffusion lands mid-range at the corrected radius,
 *  so a pass is a reading rather than a flat wash. */
const RADIUS = 8;

/** The panel, before its own scale: 480x80 and 120x320 are 38,400 units² each. */
const PANEL = { width: 120, height: 80 } as const;

interface Placement {
  readonly id: string;
  readonly left: number;
  readonly top: number;
  readonly scaleX: number;
  readonly scaleY: number;
  /** The band's artboard-x window, inside the panel and clear of the marker. */
  readonly band: { readonly left: number; readonly width: number };
}

const PANELS = [
  {
    id: "wide",
    left: 20,
    top: 300,
    scaleX: 4,
    scaleY: 1,
    band: { left: 60, width: 240 },
  },
  {
    id: "tall",
    left: 510,
    top: 60,
    scaleX: 1,
    scaleY: 4,
    band: { left: 520, width: 100 },
  },
] as const satisfies readonly Placement[];

function panelOf(placement: Placement): Record<string, unknown> {
  return {
    type: "Rect",
    version: "7.4.0",
    originX: "left",
    originY: "top",
    left: placement.left,
    top: placement.top,
    width: PANEL.width,
    height: PANEL.height,
    scaleX: placement.scaleX,
    scaleY: placement.scaleY,
    fill: "rgba(255, 255, 255, 0.10)",
    id: placement.id,
    selectable: false,
    evented: false,
    yunariPaint: { fill: "palette.panel" },
    yunariGlass: { blurRadius: RADIUS },
  };
}

/** The fixture's own artboard, palette and media, with two stretched panels. */
function packageFor(): Uint8Array {
  const written = writeThemePackage({
    envelope: {
      ...GLASS_ENVELOPE,
      id: "e2e-glass-stretch",
      scene: {
        version: "7.4.0",
        objects: PANELS.map((placement) => panelOf(placement)),
      },
    },
    assets: { "assets/stripes.png": glassStripesPng() },
  });
  if (!written.ok) throw new Error(written.message);
  return written.bytes;
}

const EDITOR = "http://127.0.0.1:4174/";

test.describe("a panel's blur follows its own scale", () => {
  test.setTimeout(240_000);
  test("stretching one axis diffuses as much as stretching the other", async ({
    page,
  }) => {
    await page.goto(EDITOR);
    await openThemeFromStore(page, storedThemeOfPackage(packageFor()));

    const readings = [] as Array<{ id: string; glass: number; media: number }>;
    for (const placement of PANELS) {
      const reading = await readGlass(page, {
        id: placement.id,
        band: placement.band,
      });
      // The precondition every comparison below needs: there is a real blurred
      // backdrop in the band, not a flat wash and not an untouched panel.
      assertBlur(reading, placement.id);
      readings.push({
        id: placement.id,
        glass: reading.glass.peakGradient,
        media: reading.reference.peakGradient,
      });
    }

    for (const reading of readings)
      console.log(
        `GLASS STRETCH ${reading.id.padEnd(5)} peakGradient=${reading.glass.toFixed(3)} ` +
          `media=${reading.media.toFixed(3)}`,
      );

    const [wide, tall] = readings;
    if (wide === undefined || tall === undefined)
      throw new Error("a panel went unmeasured");

    // **The two bands carry the same pattern, so they are comparable at all.**
    // Both read the media itself, unblurred, over their own window; the bars are
    // uniform, so a difference here would mean the windows are not over the same
    // backdrop and the reading below would be about the fixture.
    expect(
      Math.abs(tall.media - wide.media) / wide.media,
      `both bands sit over the same bar pattern (wide ${wide.media.toFixed(1)} vs tall ${tall.media.toFixed(1)})`,
    ).toBeLessThan(0.2);

    // **The claim.** One authored value, one device scale, two panels of equal
    // area stretched on opposite axes: the diffusion is the same, so the pattern
    // comes through them at the same contrast. `scaleX`-only read 4x apart here.
    expect(
      Math.abs(tall.glass - wide.glass) / wide.glass,
      `a panel stretched 4x1 diffuses as much as one stretched 1x4 (wide ${wide.glass.toFixed(3)} vs tall ${tall.glass.toFixed(3)})`,
    ).toBeLessThan(0.25);
  });
});
