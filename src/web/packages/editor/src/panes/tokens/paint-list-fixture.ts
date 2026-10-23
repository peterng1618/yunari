/**
 * The document `paint-list.dom.test.tsx` drives the Tokens pane with.
 *
 * Every colour here is a *document* value — a paint an author typed into the
 * document's own palette, or one this suite types into the field — rather than
 * styling the shell paints, so the fixtures live beside the test instead of
 * inside it. They were in the test file, which is why it is not in the JSON's
 * source list; the values a case asserts back are named here so the assertion
 * and the fixture cannot drift apart.
 */
import type { FabricPalette } from "@yunari/renderer-core";

/** The background token's paint. */
export const BACKGROUND_PAINT = "#102030";

/** The accent token's paint. */
export const ACCENT_PAINT = "#00b8d9";

/** A colour an author types into the field: distinct from every token's own, so
 *  a case that changes nothing else is not passing on a value already there. */
export const TYPED_PAINT = "#123456";

/** The colour the accent token is edited to, asserted back under its own id. */
export const EDITED_ACCENT_PAINT = "#abcdef";

/** A frosted panel: a solid at 30% alpha, carried across a paint-kind switch. */
export const FROST_PAINT = "#0815234d";

/** The gradient's first stop after it has been moved, and the solid the switch
 *  back has to carry rather than an opaque white. */
export const MOVED_FROST_PAINT = "#0a16234d";

/** The colour the glow gradient's first stop is edited to. */
export const RED_PAINT = "#ff0000";

/** A colour typed in `rgb()` form, as an author or an older document writes it. */
export const AUTHORED_RGB_PAINT = "rgb(16 32 48)";

/** The same colour in the hex form the picker shows and stores. */
export const AUTHORED_RGB_HEX = "#102030";

/** A palette whose background token is authored in `rgb()`: the picker is one
 *  field reading a colour, so it shows that colour's hex form. */
export const AUTHORED_RGB_PALETTE: FabricPalette = {
  none: { name: "None", value: { kind: "solid", color: "transparent" } },
  background: {
    name: "Background",
    value: { kind: "solid", color: AUTHORED_RGB_PAINT },
  },
};

/** The three tokens the list is mounted over: one reserved, one used, one not. */
export const PAINT_LIST_PALETTE: FabricPalette = {
  none: { name: "None", value: { kind: "solid", color: "transparent" } },
  background: {
    name: "Background",
    value: { kind: "solid", color: BACKGROUND_PAINT },
  },
  accent: { name: "Accent", value: { kind: "solid", color: ACCENT_PAINT } },
};

/** The 30% alpha panel the paint-kind switch is measured on. */
export const FROSTED_PANEL: FabricPalette = {
  frost: {
    name: "Frosted panel",
    value: { kind: "solid", color: FROST_PAINT },
  },
};

/** A gradient whose stops carry the background's own fixture paint — the value
 *  is arbitrary, and only the stop list is what the cases below move. */
export const GLOW_GRADIENT: FabricPalette = {
  glow: {
    name: "Glow",
    value: {
      kind: "gradient",
      angle: 0,
      stops: [
        { offset: 0, color: BACKGROUND_PAINT },
        { offset: 1, color: BACKGROUND_PAINT },
      ],
    },
  },
};
