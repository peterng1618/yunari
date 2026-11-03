/**
 * What a palette token id says it is for.
 *
 * A palette is a typed vocabulary, not a bag of names: a document that names a
 * surface and a content ink has both, whatever it calls them. The editor's new
 * object defaults and the card library both ask this one question, so it lives
 * here rather than in either caller.
 */

import {
  type FabricPalette,
  type FabricPaletteEntry,
  isOfferedPaletteToken,
} from "@yunari/renderer-core";

/** The surfaces a chart or panel draws on. */
export const SURFACE_TOKENS = [
  "background",
  "scene",
  "surface",
  "track",
  "charttrack",
];

/** The surfaces a *card* takes, ahead of the scene's own: a shape filled with
    the backdrop is that backdrop again, and nothing an author can select. */
export const CARD_SURFACE_TOKENS = ["panel", "frost", ...SURFACE_TOKENS];

/** A token id naming content ink, in preference order. Not simply the first
    entry: a palette conventionally starts with its background and letterbox
    colours, so taking the first one paints new content in the canvas colour —
    invisible, and therefore impossible to select or edit. */
const CONTENT_TOKENS = ["text", "ink", "foreground", "primary", "accent"];

function entriesOf(
  palette: FabricPalette | undefined,
): readonly (readonly [string, FabricPaletteEntry])[] {
  return Object.entries(palette ?? {}).filter(([id]) =>
    isOfferedPaletteToken(id),
  );
}

/**
 * The token new content draws with: a content name if the palette has one,
 * otherwise the first token that is not a surface.
 *
 * Shared by the editor's new-object defaults and the kit's chart defaults, so
 * an agent-authored chart is painted by the same rule as one inserted on the
 * canvas.
 */
export function contentPaletteToken(
  palette: FabricPalette | undefined,
): readonly [string, FabricPaletteEntry] | undefined {
  const entries = entriesOf(palette);
  return (
    CONTENT_TOKENS.map((name) =>
      entries.find(([id]) => id.toLowerCase() === name),
    ).find((entry) => entry !== undefined) ??
    entries.find(([id]) => !SURFACE_TOKENS.includes(id.toLowerCase())) ??
    entries[0]
  );
}

/** The token for a surface an object draws on, in the caller's own surface
    vocabulary: a card and a chart track are not the same surface. */
export function surfacePaletteToken(
  palette: FabricPalette | undefined,
  candidates: readonly string[],
): readonly [string, FabricPaletteEntry] | undefined {
  const entries = entriesOf(palette);
  return (
    candidates
      .map((name) => entries.find(([id]) => id.toLowerCase() === name))
      .find((entry) => entry !== undefined) ?? entries[0]
  );
}

/**
 * Whether a palette token id names a surface or content ink.
 *
 * `CARD_SURFACE_TOKENS` is the surface side rather than `SURFACE_TOKENS`,
 * because `panel` and `frost` are surfaces too and a card asks for them by
 * name. Matching is case-insensitive for the reason the editor's surface lookup
 * gives.
 */
export function paletteTokenRole(id: string): "surface" | "ink" {
  return CARD_SURFACE_TOKENS.includes(id.toLowerCase()) ? "surface" : "ink";
}
