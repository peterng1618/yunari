import type { CellAction } from "./local-source.js";

/**
 * Why a cell's action is drawn disabled, or `undefined` for one a build runs.
 *
 * The surface gives every cell four actions and the item's footer the same four,
 * so all four stay drawn (R164) — and the one **no task in this plan and no
 * phase owns** is disabled where it is drawn, with its reason, rather than
 * answering a press with nothing. One owner for that fact, because the cell and
 * the footer both draw the four and a second list would be a second answer to
 * "does this action run".
 *
 * It is total over `CellAction`, so an action added to the union fails to compile
 * here rather than arriving silently live. A phase that takes one up moves it out
 * of this map in the same change — and the region's `onAction` with it.
 *
 * **Delete runs through the host's own removal route**, which moves the theme's
 * folder to the recycle bin, so the action is live and the region drops the item
 * after the host accepts it. **Export reads the stored theme and writes the
 * package the format documents**, so the region owns the download and this map
 * has no disabled action left.
 */
export const CELL_ACTION_REASONS: Readonly<
  Record<CellAction, string | undefined>
> = {
  open: undefined,
  assign: undefined,
  export: undefined,
  delete: undefined,
};
