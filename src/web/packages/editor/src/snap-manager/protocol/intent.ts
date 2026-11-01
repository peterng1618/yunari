import { SNAP_THRESHOLD, SPACING_SNAP_HOLD_MARGIN } from "../constants.js";

/** One gesture's thresholds in scene coordinates. */
export type SnapThresholds = Readonly<{
  acquire: number;
  release: number;
  spacingRelease: number;
  verification: number;
}>;

/**
 * Converts the screen-pixel thresholds into scene coordinates, with zoom applied.
 * Callers that require a sound zoom validate it at their own boundary.
 */
export function createSnapThresholds({
  zoom,
  verification,
}: {
  zoom: number;
  verification: number;
}): SnapThresholds {
  return Object.freeze({
    acquire: SNAP_THRESHOLD / zoom,
    release: SNAP_THRESHOLD / zoom,
    spacingRelease: (SNAP_THRESHOLD + SPACING_SNAP_HOLD_MARGIN) / zoom,
    verification,
  });
}
