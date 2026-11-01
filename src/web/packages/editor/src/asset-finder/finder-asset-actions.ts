import type { ListingCategory } from "@yunari/renderer-core";
import { uiCopy } from "../ui-copy.js";
import type { AssetPlacement } from "./actions.js";
import type { FinderAction } from "./finder-controls.js";
import type { ActionOutcome } from "./finder-model.js";
import type { FinderRow } from "./tab-data.js";

/** The same two actions, built for whichever row they are about: the footer's
 *  selection, or a card the author double-clicked. */
export function assetActionsFor(props: {
  readonly active: ListingCategory;
  readonly row: FinderRow | undefined;
  readonly busy: boolean;
  readonly runRow: (
    row: FinderRow,
    placement?: AssetPlacement,
  ) => Promise<ActionOutcome>;
}): readonly FinderAction[] {
  const run =
    (placement?: AssetPlacement): FinderAction["run"] =>
    () =>
      props.row === undefined
        ? Promise.resolve({ ok: false, message: uiCopy.assets.noSelection })
        : props.runRow(props.row, placement);
  const place: FinderAction = {
    id: "place",
    label: uiCopy.assets.placeOnCanvas,
    busyLabel: uiCopy.assets.busy.icon,
    tone: "plain",
    disabled: props.row === undefined || props.busy,
    run: run("place"),
  };
  const main: FinderAction = {
    id: "apply",
    label: uiCopy.assets.action[props.active],
    busyLabel: uiCopy.assets.busy[props.active],
    tone: "accent",
    disabled: props.row === undefined || props.busy,
    run: run(props.active === "image" ? "background" : undefined),
  };
  return props.active === "image" ? [place, main] : [main];
}
