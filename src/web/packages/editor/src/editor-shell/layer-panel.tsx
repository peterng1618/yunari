import { ControlIconButton } from "../components/ui/control-icon-button.js";
import {
  destructiveMarker,
  hasSelection,
  OBJECT_ACTIONS,
  objectActionsFor,
} from "../object-actions.js";
import type { EditorShellBridge } from "./bridge.js";
import { Glyph } from "./icons.js";

/**
 * The Composition pane's footer toolbar: the object commands the registry holds
 * for this pane (the pane rule, "a pane footer is bounded by its pane"). It is a Pane
 * footer rather than a row of the tree, so it belongs to the pane and not to the
 * list. The pane still scrolls as one — the scroll box is
 * `aside.editor-shell-panel`, which holds header, body and this footer — so it
 * does not stay pinned while the list moves under it. That gap against the overflow rule is
 * filed as `vg-208`; the aside is deliberately the single scroller.
 *
 * **With nothing selected the registry's whole command set is drawn, disabled**
 * (`vg-570`, ruled by the user 2026-10-17). `vg-460`'s ask was that the toolbar
 * always be *visible*; the answer built for it — the Add pane's constructions,
 * drawn in every state — was never asked for, so it is gone. A footer with no
 * selection is the registry's own commands greyed: not empty, and not a second
 * set of constructions. With a selection the registry's filter answers as it
 * always has, and an action the selection cannot run is absent rather than
 * greyed — the arrange half is the one that greys, on the selection inspector's
 * lead (`vg-463`).
 *
 * Eligibility is the registry's alone — `objectActionsFor` is the dock's own
 * filter, so the two surfaces agree on the command half and neither re-decides it
 * here. The no-selection row above is not a second eligibility rule: it draws
 * what the registry holds and says, by being disabled, that there is no subject
 * to run it against.
 */
export function LayerActions({
  bridge,
}: {
  readonly bridge: EditorShellBridge | undefined;
}): React.JSX.Element {
  // No bridge is no document, and so no selection either: both routes to
  // "nothing selected" take this branch, which is what keeps the footer from
  // ever being the empty row `vg-460` reported.
  const selected = bridge !== undefined && hasSelection(bridge.target());
  const actions =
    bridge === undefined || !selected
      ? OBJECT_ACTIONS
      : objectActionsFor(bridge);
  return (
    <footer className="editor-shell-pane-actions" data-yunari-layer-actions="">
      {actions.map((action) => (
        <ControlIconButton
          key={action.id}
          label={action.label}
          disabled={!selected}
          // The mark is the whole mechanism: `destructiveMarker` carries the
          // registry's flag to every surface, and the one
          // `[data-yunari-destructive]` rule in the shell paints it `--hot`.
          // Nothing here says "destructive" a second time.
          data={destructiveMarker(action)}
          onClick={() => bridge?.run(action.id)}
        >
          <Glyph icon={action.icon} size={15} />
        </ControlIconButton>
      ))}
    </footer>
  );
}
