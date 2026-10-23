import { formatColor, parseColor } from "@yunari/renderer-core";

/**
 * The paints the editor spec's fixture documents are authored with.
 *
 * A document's colours are its author's, not the shell's, so they are fixture
 * data rather than styling — the same reason `glass-fixture.ts` holds its own.
 * `ACCENT_PAINT` is one authored fact in Fabric's two representations (a scene
 * object's resolved `fill` and the `palette.accent` entry behind it), so both
 * read it here rather than each spelling it.
 */

/**
 * The stored spelling of an authored colour. The picker commits `formatColor`'s
 * form, so a spec that compares a saved envelope states the colour it typed and
 * derives the hex the document keeps rather than copying it.
 */
export function storedColour(css: string): string {
  const rgba = parseColor(css);
  if (rgba === undefined) throw new Error(`not a colour: ${css}`);
  return formatColor(rgba);
}

/** The colour typed into the palette field, and read back out of it. */
export const PALETTE_FIELD_PAINT = "#123456";

/** The incompatible document's artboard paint. */
export const ARTBOARD_BACKGROUND_PAINT = "#101216";

/** The gradient document's `background` and `bars` stops. */
export const BACKGROUND_PAINT = "#102030";
export const BACKGROUND_END_PAINT = "#d0e0f0";
export const BARS_START_PAINT = "#001122";
export const BARS_END_PAINT = "#334455";

/** The fixtures' accent: the palette entry and every object's resolved fill. */
export const ACCENT_PAINT = "#00b8d9";

/** The plate/ink pair the reorder fixture's palette declares. */
export const PLATE_PAINT = "#101318";
export const INK_PAINT = "#ecf5ff";
