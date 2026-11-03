/**
 * How many columns the store's gallery draws, and the viewer's say in it.
 *
 * **The default is responsive, the choice is not.** With nothing stored, the
 * count follows the region's width at the same 272px minimum the grid used
 * before, so a 1080p region opens on six columns, a 1352px one on four, and 4K
 * at the maximum. A viewer who picks a density keeps that number across
 * resizes: the control exists to override the width, so re-deriving the choice
 * from the window would take the choice back.
 *
 * The bounds cover the same screens the default does. Two columns is the
 * narrowest pane that still reads as a gallery; eight is the densest a 4K
 * region should get.
 */

/** The narrowest a card column may get; the same 272px the grid declares. */
const MIN_COLUMN = 272;
/** The grid's gutter, which the column count has to leave room for between
 *  each pair of tracks. */
const COLUMN_GAP = 12;

export const GRID_COLUMNS_MIN = 2;
export const GRID_COLUMNS_MAX = 8;

/** The store's own storage key. Namespaced like the shell's palette choice:
 *  never serialized into a theme, never authored state. */
const storageKey = "yunari.editor.store-grid-columns";

/** How many 272px columns `width` holds, clamped to the offered range. */
export function autoColumnsForWidth(width: number): number {
  const fit = Math.floor((width + COLUMN_GAP) / (MIN_COLUMN + COLUMN_GAP));
  return Math.min(GRID_COLUMNS_MAX, Math.max(GRID_COLUMNS_MIN, fit));
}

/** One viewer's density, or no choice yet. */
export interface GridDensityPreference {
  /** The chosen count, or `undefined` where the viewer has not chosen and
   *  a stored value this build cannot read is the same as no value. */
  read(): number | undefined;
  write(columns: number): void;
  clear(): void;
}

/** A stored value as a count, or nothing: an out-of-range or malformed entry is
 *  refused rather than clamped, because clamping would silently accept a value
 *  no control offered. */
function storedColumns(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const columns = Number(raw);
  return Number.isInteger(columns) &&
    columns >= GRID_COLUMNS_MIN &&
    columns <= GRID_COLUMNS_MAX
    ? columns
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
        return storedColumns(storage?.getItem(storageKey) ?? null);
      } catch {
        return undefined;
      }
    },
    write: (columns) => {
      try {
        storage?.setItem(storageKey, String(columns));
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
