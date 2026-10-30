/** Artboard sizes, derived from a ratio, an orientation and a resolution.
    A new document picks one; a document with a size the presets cannot name
    keeps it, because the numeric fields are the same fields (the artboard panel). */

export type ArtboardRatioId = "16:9" | "19.5:9" | "4:3" | "circle";
export type ArtboardResolutionId = "1080p" | "2k" | "4k";
export type ArtboardOrientation = "landscape" | "portrait";

export interface ArtboardSize {
  readonly width: number;
  readonly height: number;
}

export const ARTBOARD_RATIOS: ReadonlyArray<{
  readonly id: ArtboardRatioId;
  readonly ratio: number;
}> = [
  { id: "16:9", ratio: 16 / 9 },
  { id: "19.5:9", ratio: 19.5 / 9 },
  { id: "4:3", ratio: 4 / 3 },
  // A round display's square. The panel shows the disc inscribed in it: the
  // four edges touch the ring and the corners fall outside the glass.
  { id: "circle", ratio: 1 },
];

/** A resolution names the **short** edge — 19.5:9 at 1080p is 2340 × 1080, not
    1080 × 585 — so every ratio at one resolution shares a short edge and the
    long edge is the ratio's work. */
export const ARTBOARD_RESOLUTIONS: ReadonlyArray<{
  readonly id: ArtboardResolutionId;
  readonly shortEdge: number;
}> = [
  { id: "1080p", shortEdge: 1080 },
  { id: "2k", shortEdge: 1440 },
  { id: "4k", shortEdge: 2160 },
];

export const ARTBOARD_ORIENTATIONS: ReadonlyArray<ArtboardOrientation> = [
  "landscape",
  "portrait",
];

/**
 * The shape a new document opens at when it has no prior shape to inherit.
 *
 * **Not the lens's owner.** The stage's opening lens is resolved at mount from
 * the active catalogue — its own first landscape entry — so a fresh mount after
 * 16:9 is removed from the catalogue opens the stage on a different lens while
 * a new document with no prior shape still opens at this one. (Removing the
 * live lens clears to Fit instead.) The two are the same shape today only
 * because 16:9 is the catalogue's first landscape default.
 *
 * The ratio and resolution a new document opens at, and the orientation it is
 * held.
 */
export const DEFAULT_ARTBOARD_PRESET = {
  ratio: "16:9",
  resolution: "1080p",
  orientation: "landscape",
} as const satisfies ArtboardPresetChoice;

interface ArtboardPresetChoice {
  readonly ratio: ArtboardRatioId;
  readonly resolution: ArtboardResolutionId;
  readonly orientation: ArtboardOrientation;
}

/** A ratio and an orientation with no resolution attached: the shape something
    is measured in. Carries no resolution because a display says a shape and the
    resolution is the author's later choice — argued at `DisplayLens.shape`. */
export type ArtboardShape = Pick<ArtboardPresetChoice, "ratio" | "orientation">;

/** Portrait is landscape with the two edges swapped, so one number per entry
    covers both and the two orientations cannot drift apart. */
export function artboardSize(
  ratio: ArtboardRatioId,
  resolution: ArtboardResolutionId,
  orientation: ArtboardOrientation,
): ArtboardSize {
  const shortEdge = ARTBOARD_RESOLUTIONS.find(
    (entry) => entry.id === resolution,
  )?.shortEdge;
  const factor = ARTBOARD_RATIOS.find((entry) => entry.id === ratio)?.ratio;
  if (shortEdge === undefined || factor === undefined) {
    // Refuse rather than default: this is a trust boundary for anything
    // persisting a size, and a silently-defaulted artboard is a document the
    // author did not draw.
    throw new RangeError(`no artboard preset for ${ratio} at ${resolution}`);
  }
  const longEdge = Math.round(shortEdge * factor);
  return orientation === "portrait"
    ? { width: shortEdge, height: longEdge }
    : { width: longEdge, height: shortEdge };
}

/** Every size the presets can name, built once: a panel showing a document
    needs to ask which one it is holding, and that is the owner's question. */
const EVERY_PRESET: ReadonlyArray<ArtboardSize & ArtboardPresetChoice> =
  ARTBOARD_ORIENTATIONS.flatMap((orientation) =>
    ARTBOARD_RESOLUTIONS.flatMap((resolution) =>
      ARTBOARD_RATIOS.map((ratio) => ({
        ...artboardSize(ratio.id, resolution.id, orientation),
        ratio: ratio.id,
        resolution: resolution.id,
        orientation,
      })),
    ),
  ).filter(
    // A square is one size whichever orientation asked for it, and
    // `artboardOrientation` calls it landscape. Keeping the portrait twin would
    // be a second entry for the same size that matching can never name.
    (preset) => artboardOrientation(preset) === preset.orientation,
  );

/** The three ids a size came from, or `undefined` when none of them do — a
    size the author typed, or a hand-edited theme. A caller showing a control
    must not claim a preset the document is not at. */
export function artboardPresetFor(
  size: ArtboardSize,
): ArtboardPresetChoice | undefined {
  const match = EVERY_PRESET.find(
    (preset) => preset.width === size.width && preset.height === size.height,
  );
  if (match === undefined) return undefined;
  return {
    ratio: match.ratio,
    resolution: match.resolution,
    orientation: match.orientation,
  };
}

/**
 * Which way up a size is.
 *
 * **One predicate, in the one place that has to know.** `nearestArtboardPreset`
 * and the display lens's grouping both answer "is this document portrait", and
 * two `height > width` tests are two answers that can drift — a portrait theme
 * offered landscape previews is exactly the failure the owner ruled a square
 * acceptable to avoid.
 *
 * A square is not taller, so it reads landscape. The owner's ruling: it keeps
 * this one comparison rather than a second one for the case neither half of
 * the table names.
 */
export function artboardOrientation(size: ArtboardSize): ArtboardOrientation {
  return size.height > size.width ? "portrait" : "landscape";
}

/**
 * The preset a new document should open on, given the document it replaces.
 *
 * **A different question from `artboardPresetFor`, in the same module.** That
 * one asks what a size *is* and answers `undefined` when it is not a preset,
 * because a control showing the current document must not claim a preset the
 * document is not at. This one asks what to *offer next*, and for that the
 * nearest answer is the right one: a 1280 × 2778 phone screen is not a preset,
 * and answering "no idea" would hand the author back the 16:9 landscape
 * default — the exact stranding the new-document chooser exists to avoid.
 *
 * The chooser has no "custom" entry and the size it derives is on screen, so
 * a guess it cannot name would be a size its own controls deny; the fallback
 * is the default, which they can.
 */
export function nearestArtboardPreset(
  size?: ArtboardSize,
): ArtboardPresetChoice {
  if (size === undefined) return DEFAULT_ARTBOARD_PRESET;
  const exact = artboardPresetFor(size);
  if (exact !== undefined) return exact;

  const closest = nearestBy(ARTBOARD_RATIOS, (entry) =>
    // `ARTBOARD_RATIOS` holds landscape ratios, and a portrait document's
    // aspect is the reciprocal of the one it would be named for — 1080 × 2340
    // is 0.46 against a 19.5:9 entry of 2.17. Long-over-short, or a portrait
    // document is matched as square and lands on 4:3.
    Math.abs(
      entry.ratio -
        Math.max(size.width, size.height) / Math.min(size.width, size.height),
    ),
  );
  const nearest = nearestBy(ARTBOARD_RESOLUTIONS, (entry) =>
    Math.abs(entry.shortEdge - Math.min(size.width, size.height)),
  );
  if (closest === undefined || nearest === undefined) {
    return DEFAULT_ARTBOARD_PRESET;
  }

  return {
    ratio: closest.id,
    resolution: nearest.id,
    orientation: artboardOrientation(size),
  };
}

function nearestBy<T>(
  candidates: ReadonlyArray<T>,
  distance: (candidate: T) => number,
): T | undefined {
  let best: T | undefined;
  let closest = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const span = distance(candidate);
    if (span < closest) {
      best = candidate;
      closest = span;
    }
  }
  return best;
}
