/**
 * What a palette token id says it is for.
 *
 * A palette is a typed vocabulary, not a bag of names: a document that names a
 * surface and a content ink has both, whatever it calls them. The editor's new
 * object defaults and the card library both ask this one question, so it lives
 * here rather than in either caller.
 */

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
