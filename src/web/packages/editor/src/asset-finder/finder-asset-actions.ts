import type { ListingCategory } from "@yunari/renderer-core";
import { uiCopy } from "../ui-copy.js";
import type { AssetPlacement } from "./actions.js";
import type { FinderAction } from "./finder-controls.js";
import { type ActionOutcome, categoryWord } from "./finder-model.js";
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
    // A declared category this build has no word or bulk action for falls back
    // to the general import action the grid already runs.
    label:
      categoryWord(uiCopy.assets.action, props.active) ??
      uiCopy.assets.placeOnCanvas,
    busyLabel:
      categoryWord(uiCopy.assets.busy, props.active) ?? uiCopy.assets.working,
    tone: "accent",
    disabled: props.row === undefined || props.busy,
    run: run(props.active === "image" ? "background" : undefined),
  };
  return props.active === "image" ? [place, main] : [main];
}
