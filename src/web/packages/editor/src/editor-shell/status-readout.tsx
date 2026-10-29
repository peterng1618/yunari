import { uiCopy } from "../ui-copy.js";
import { type SelectionStore, useSelection } from "./shell-stores.js";

/**
 * §7.6's left readouts: the scene's object total and the selection's size.
 *
 * These are the strip's resting content. The message span beside them carries
 * nothing until `editor-main` has something to report, and a report is a moment
 * rather than a reading — so the counts are what the left holds when the editor
 * is simply open, and a message is added to them rather than standing in their
 * place.
 *
 * Both numbers come from the bridge's one snapshot, so the strip, the layer
 * list and the dock's arrange eligibility cannot disagree about what is on the
 * canvas. They are two elements rather than one so the footer's own gap spaces
 * them, which is the shape §7.6's readout row is drawn in.
 *
 * **No scene is not a scene with nothing in it.** Before a bridge is set there
 * is no total to read, so the strip draws nothing rather than `0 objects` — a
 * reading the product does not have. A document that really
 * holds nothing reports `0`, and that is an answer.
 */
export function StatusReadout({
  store,
}: {
  readonly store: SelectionStore;
}): React.JSX.Element | null {
  const { objectCount, selectedCount } = useSelection(store);
  if (objectCount === undefined) return null;
  return (
    <>
      <span data-yunari-status-objects="">
        {uiCopy.statusBar.objects(objectCount)}
      </span>
      <span data-yunari-status-selected="">
        {uiCopy.statusBar.selected(selectedCount)}
      </span>
    </>
  );
}
