import { uiCopy } from "../ui-copy.js";
import type { CellAction } from "./local-source.js";

/**
 * Why a cell's action is drawn disabled, or `undefined` for one a build runs.
 *
 * The drawing gives every cell four actions and the item's footer the same four,
 * so all four stay drawn (R164) — and the two **no task in this plan and no
 * phase owns** are disabled where they are drawn,
 * with their reason, rather than answering a press with nothing. One owner for
 * that fact, because the cell and the footer both draw the four and a second
 * list would be a second answer to "does this action run".
 *
 * It is total over `CellAction`, so an action added to the union fails to compile
 * here rather than arriving silently live. A phase that takes one up moves it out
 * of this map in the same change — and the region's `onAction` with it.
 */
export const CELL_ACTION_REASONS: Readonly<
  Record<CellAction, string | undefined>
> = {
  open: undefined,
  assign: undefined,
  export: uiCopy.store.cell.unavailable,
  delete: uiCopy.store.cell.unavailable,
};
