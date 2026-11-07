import {
  type AssetKind,
  BACKGROUND_ANCHORS,
  BACKGROUND_MEDIA_BOUNDS,
  type BackgroundAnchor,
  type BackgroundMedia,
  type BackgroundMediaBounds,
  type BackgroundMediaComposition,
  type BackgroundMode,
  DEFAULT_BACKGROUND_MEDIA_BOUNDS,
  MAX_BACKGROUND_EXTENT,
  MAX_BACKGROUND_FADE,
  MAX_BACKGROUND_OFFSET,
  MAX_BACKGROUND_SCALE,
  MIN_BACKGROUND_EXTENT,
  MIN_BACKGROUND_FADE,
  MIN_BACKGROUND_OFFSET,
  MIN_BACKGROUND_SCALE,
} from "@yunari/renderer-core";

/** The sidecar's own version. A file this build does not know is empty memory. */
export const BACKGROUND_MEDIA_MEMORY_VERSION = 1;

/**
 * One asset's working geometry, everything the document's media carries except
 * the id that keys it.
 *
 * It is editor working data, not authored state: it never enters the envelope,
 * the exported package or a display's read.
 */
export interface BackgroundMediaMemoryEntry {
  readonly bounds: BackgroundMediaBounds;
  readonly offsetX?: number;
  readonly offsetY?: number;
  readonly scale?: number;
  readonly flipX?: boolean;
  readonly flipY?: boolean;
  readonly composition?: BackgroundMediaComposition;
  readonly fallbackFrame?: number;
}

/** The per-asset map, keyed by asset id. */
export type BackgroundMediaMemory = Readonly<
  Record<string, BackgroundMediaMemoryEntry>
>;

const invalid = Symbol("invalid");
type Invalid = typeof invalid;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBounds(value: unknown): value is BackgroundMediaBounds {
  return (
    typeof value === "string" &&
    (BACKGROUND_MEDIA_BOUNDS as readonly string[]).includes(value)
  );
}

function isAnchor(value: unknown): value is BackgroundAnchor {
  return (
    typeof value === "string" &&
    (BACKGROUND_ANCHORS as readonly string[]).includes(value)
  );
}

function numberIn(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined | Invalid {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    return invalid;
  }
  return value;
}

function readComposition(
  value: unknown,
): BackgroundMediaComposition | undefined | Invalid {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return invalid;

  const anchor = value["anchor"];
  if (anchor !== undefined && !isAnchor(anchor)) return invalid;
  const extent = numberIn(
    value["extent"],
    MIN_BACKGROUND_EXTENT,
    MAX_BACKGROUND_EXTENT,
  );
  const fade = numberIn(
    value["fade"],
    MIN_BACKGROUND_FADE,
    MAX_BACKGROUND_FADE,
  );
  if (extent === invalid || fade === invalid) return invalid;

  return {
    ...(anchor === undefined ? {} : { anchor }),
    ...(extent === undefined ? {} : { extent }),
    ...(fade === undefined ? {} : { fade }),
  };
}

/**
 * One stored entry, or nothing.
 *
 * Every present field is validated against the envelope schema's own bounds;
 * an entry carrying a value this editor would refuse is dropped whole rather
 * than half-restored into a document that then fails its validator.
 */
function readEntry(value: unknown): BackgroundMediaMemoryEntry | undefined {
  if (!isRecord(value)) return undefined;
  const bounds = value["bounds"];
  if (!isBounds(bounds)) return undefined;

  const offsetX = numberIn(
    value["offsetX"],
    MIN_BACKGROUND_OFFSET,
    MAX_BACKGROUND_OFFSET,
  );
  const offsetY = numberIn(
    value["offsetY"],
    MIN_BACKGROUND_OFFSET,
    MAX_BACKGROUND_OFFSET,
  );
  const scale = numberIn(
    value["scale"],
    MIN_BACKGROUND_SCALE,
    MAX_BACKGROUND_SCALE,
  );
  const composition = readComposition(value["composition"]);

  const flipX = value["flipX"];
  const flipY = value["flipY"];
  const frame = value["fallbackFrame"];

  if (
    offsetX === invalid ||
    offsetY === invalid ||
    scale === invalid ||
    composition === invalid ||
    (flipX !== undefined && typeof flipX !== "boolean") ||
    (flipY !== undefined && typeof flipY !== "boolean") ||
    (frame !== undefined &&
      (typeof frame !== "number" || !Number.isInteger(frame) || frame < 0))
  ) {
    return undefined;
  }

  return {
    bounds,
    ...(offsetX === undefined ? {} : { offsetX }),
    ...(offsetY === undefined ? {} : { offsetY }),
    ...(scale === undefined ? {} : { scale }),
    ...(flipX === undefined ? {} : { flipX }),
    ...(flipY === undefined ? {} : { flipY }),
    ...(composition === undefined ? {} : { composition }),
    ...(frame === undefined ? {} : { fallbackFrame: frame }),
  };
}

/**
 * The map a stored sidecar member holds.
 *
 * Absence, a foreign version or a malformed member is empty working data: the
 * sidecar is bookkeeping, so it may never cost an author the theme it belongs
 * to.
 */
export function readBackgroundMediaMemory(
  value: unknown,
): BackgroundMediaMemory {
  if (!isRecord(value)) return {};
  if (value["version"] !== BACKGROUND_MEDIA_MEMORY_VERSION) return {};
  const media = value["media"];
  if (!isRecord(media)) return {};

  const memory: Record<string, BackgroundMediaMemoryEntry> = {};
  for (const [assetId, raw] of Object.entries(media)) {
    const entry = readEntry(raw);
    if (entry !== undefined) memory[assetId] = entry;
  }
  return memory;
}

/** The versioned member a save sends and the sidecar holds. */
export function encodeBackgroundMedia(memory: BackgroundMediaMemory): {
  readonly version: 1;
  readonly media: BackgroundMediaMemory;
} {
  return { version: BACKGROUND_MEDIA_MEMORY_VERSION, media: memory };
}

/**
 * Remembers the media that is about to stop being shown.
 *
 * The simple model has no composition, so its absence on the way out is not a
 * deletion: the entry keeps the one advanced authored, and a later toggle back
 * restores it. Once `advanced` is the mode in force, absence is the author
 * clearing the composition and it is stored as absence.
 */
export function rememberBackgroundMedia(
  memory: BackgroundMediaMemory,
  media: BackgroundMedia | undefined,
  mode: BackgroundMode,
): BackgroundMediaMemory {
  if (media === undefined) return memory;

  const { assetId, composition, ...geometry } = media;
  const previous = memory[assetId]?.composition;
  const next: BackgroundMediaMemoryEntry =
    mode === "advanced"
      ? { ...geometry, ...(composition === undefined ? {} : { composition }) }
      : {
          ...geometry,
          ...(previous === undefined ? {} : { composition: previous }),
        };

  return { ...memory, [assetId]: next };
}

/**
 * The media a switch restores.
 *
 * An unseen asset gets the defaults rather than the outgoing asset's box: how
 * one picture was framed is not a statement about another. A composition is
 * restored only in the advanced model that can express it, and a fallback frame
 * only for the video that has frames.
 */
export function restoreBackgroundMedia(
  entry: BackgroundMediaMemoryEntry | undefined,
  assetId: string,
  kind: AssetKind,
  mode: BackgroundMode,
): BackgroundMedia {
  const { composition, fallbackFrame, ...geometry } = entry ?? {
    bounds: DEFAULT_BACKGROUND_MEDIA_BOUNDS,
  };
  return {
    assetId,
    ...geometry,
    ...(mode === "advanced" && composition !== undefined
      ? { composition }
      : {}),
    ...(kind === "video" && fallbackFrame !== undefined
      ? { fallbackFrame }
      : {}),
  };
}

/** The map reduced to the assets a document still declares. */
export function filterBackgroundMedia(
  memory: BackgroundMediaMemory,
  keep: ReadonlySet<string>,
): BackgroundMediaMemory {
  return Object.fromEntries(
    Object.entries(memory).filter(([assetId]) => keep.has(assetId)),
  );
}
