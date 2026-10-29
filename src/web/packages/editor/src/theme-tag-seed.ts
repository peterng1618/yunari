/**
 * The style vocabulary an author picks from before the editor has ever seen the
 * catalogue.
 *
 * The vocabulary *is* the catalogue's own content, so this list is the offline
 * fallback and nothing else: a reachable catalogue replaces it, it is not an
 * enum, no validator reads it, and a tag outside it is writable (that is what
 * proposing is for). The seven are seed examples and `vg-683` may revise them.
 */
export const THEME_TAG_SEED: readonly string[] = [
  "futuristic",
  "retro",
  "modern",
  "elegant",
  "classic",
  "nature",
  "cityscape",
];
