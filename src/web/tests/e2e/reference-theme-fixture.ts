/**
 * The reference-composition capture fixtures: the badge asset it packages, and
 * the resolved paint the two scene objects that reference `palette.edge` carry.
 *
 * A document's colours are its author's, not the shell's, so they are fixture
 * data rather than styling — the same reason `glass-fixture.ts` holds its own.
 */

/**
 * The resolved `fill` the two textboxes that reference `palette.edge` carry.
 * The shared envelope's `edge` entry declares `rgba(255, 255, 255, 0.35)`; the
 * fixture writes the opaque spelling, and the validator accepts the reference
 * either way. Recorded as the fixture has it rather than reconciled here, which
 * would be a change to what the reference renders rather than to where the
 * value lives.
 */
export const EDGE_OBJECT_FILL = "#ffffff";

/** The badge the capture fixture packages as `assets/badge.svg`. */
export const REFERENCE_BADGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 40" width="128" height="40">
  <rect width="64" height="40" fill="#101820"/>
  <rect x="64" width="64" height="40" fill="#f0f4f8"/>
</svg>
`;
