/**
 * How dense the store's gallery is, and the viewer's say in it.
 *
 * **The choice is a level, the count is derived.** The header's slider offers
 * four named densities; the columns are then the width's answer for that level,
 * recomputed on every resize. A stored count would stop following the window the
 * moment it was chosen, which is what the earlier numeric well did.
 *
 * The level is a view preference, never authored state: it is written to the
 * browser's storage and never into a theme.
 */

/** The four densities, smallest cards first. */
export const GRID_DENSITY_LEVELS = [
  "compact",
  "comfortable",
  "roomy",
  "spacious",
] as const;

export type GridDensityLevel = (typeof GRID_DENSITY_LEVELS)[number];

export const DEFAULT_GRID_DENSITY: GridDensityLevel = "comfortable";

/**
 * The card width each level targets, before the width's own count is derived.
 * Every level sits a quarter below the size the gallery was first drawn at
 * (comfortable was 272px), so each step shows about a third more cards in the
 * same pane: the ladder stays the same four names, just denser throughout.
 */
const TARGET_CARD_WIDTH: Readonly<Record<GridDensityLevel, number>> = {
  compact: 150,
  comfortable: 204,
  roomy: 270,
  spacious: 360,
};

/** The gutter between cards, which the count has to leave room for. */
const COLUMN_GAP = 12;

export const GRID_COLUMNS_MIN = 2;
/** Ten columns was the ceiling at the old sizes; the denser card would clamp
 *  the two closest levels together on a wide pane, so the ceiling moves with
 *  the ladder. */
export const GRID_COLUMNS_MAX = 12;

/** The card width `level` aims at. The count is derived from the pane's width;
 *  this is the one input the level itself fixes, and the unmeasured first frame
 *  reserves a card at it. */
export function targetCardWidth(level: GridDensityLevel): number {
  return TARGET_CARD_WIDTH[level];
}

/** How many cards across `width` holds at `level`, clamped to the offered range. */
export function columnsForWidth(
  width: number,
  level: GridDensityLevel,
): number {
  const unit = TARGET_CARD_WIDTH[level];
  const fit = Math.floor((width + COLUMN_GAP) / (unit + COLUMN_GAP));
  return Math.min(GRID_COLUMNS_MAX, Math.max(GRID_COLUMNS_MIN, fit));
}

/** The card width the derived count actually gives `width`. */
export function cardWidthFor(width: number, columns: number): number {
  const tracks = Math.max(1, columns);
  return Math.max(0, (width - COLUMN_GAP * (tracks - 1)) / tracks);
}

/** The store's own storage key. Namespaced like the shell's palette choice. */
const storageKey = "yunari.editor.store-density";

/** One viewer's density, or no choice yet. */
export interface GridDensityPreference {
  /** The chosen level, or `undefined` where the viewer has not chosen and a
   *  stored value this build cannot read is the same as no value. */
  read(): GridDensityLevel | undefined;
  write(level: GridDensityLevel): void;
  clear(): void;
}

/** A stored value as a level, or nothing: an unknown word is refused rather
 *  than mapped onto a level no control offered. */
function storedLevel(raw: string | null): GridDensityLevel | undefined {
  return raw !== null &&
    (GRID_DENSITY_LEVELS as readonly string[]).includes(raw)
    ? (raw as GridDensityLevel)
    : undefined;
}

/**
 * The density preference over `storage`, or over nothing at all.
 *
 * Storage that refuses every call (a private window, a blocked third-party
 * context) is no storage: the default answers, and a write that cannot land is
 * dropped rather than reported. A preference that does not persist is not an
 * error a surface has to render.
 */
export function createGridDensityPreference(
  storage?: Storage,
): GridDensityPreference {
  return {
    read: () => {
      try {
        return storedLevel(storage?.getItem(storageKey) ?? null);
      } catch {
        return undefined;
      }
    },
    write: (level) => {
      try {
        storage?.setItem(storageKey, level);
      } catch {
        // A storage that refuses is a preference that does not persist.
      }
    },
    clear: () => {
      try {
        storage?.removeItem(storageKey);
      } catch {
        // As `write`: the key may already be gone, and that is the state.
      }
    },
  };
}
