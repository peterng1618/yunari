import type { Artboard } from "@yunari/renderer-core";

/** A circle conversion's two outputs: the board the document will hold, and the
 *  factor every authored object is scaled by to keep its place on it. */
export interface ArtboardConversion {
  readonly artboard: Artboard;
  readonly scale: number;
}

/**
 * The square artboard a rectangle becomes when its author chooses a circle.
 *
 * **The disc is inscribed, so the short edge is the diameter.** A 1920 × 1080
 * board's scene sits on a diagonal longer than either edge, which is why the
 * scale is the short edge over the diagonal rather than a plain ratio: every
 * authored point keeps its distance from the centre, and nothing the author
 * drew falls outside the disc.
 *
 * A circle board is already the answer, and converting it again is a no-op
 * rather than a second shrink.
 */
export function circleConversion(artboard: Artboard): ArtboardConversion {
  if (artboard.shape === "circle") return { artboard, scale: 1 };
  const side = Math.min(artboard.width, artboard.height);
  return {
    // Spread so every other authored field — `contentFit` today — survives the
    // conversion rather than being silently deleted with the size.
    artboard: { ...artboard, width: side, height: side, shape: "circle" },
    scale: side / Math.hypot(artboard.width, artboard.height),
  };
}
