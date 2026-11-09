import { ControlIconButton } from "../components/ui/control-icon-button.js";
import {
  destructiveMarker,
  hasSelection,
  objectActionsFor,
} from "../object-actions.js";
import { useActiveShortcuts } from "../shortcut-manager/bindings.js";
import {
  shortcutLabel,
  shortcutSpokenLabel,
} from "../shortcut-manager/display.js";
import type { EditorShellBridge } from "./bridge.js";
import { Glyph } from "./icons.js";

/**
 * The Composition pane's footer toolbar: the object commands the registry holds
 * for this pane (the pane rule, "a pane footer is bounded by its pane"). It is a Pane
 * footer rather than a row of the tree, so it belongs to the pane and not to the
 * list. The pane still scrolls as one — the scroll box is
 * `aside.editor-shell-panel`, which holds header, body and this footer — so it
 * does not stay pinned while the list moves under it. That gap against the
 * overflow rule is deliberate: the aside is the single scroller.
 *
 * **The footer exists only while a layer is selected.** With no subject
 * the registry has nothing to act on, and an empty pane should keep the pixels
 * for its tree. With a selection the registry's filter answers and an action
 * the selection cannot run is absent rather than greyed — the arrange half is
 * the one that greys, on the selection inspector's lead.
 *
 * Eligibility is the registry's alone — `objectActionsFor` is the dock's own
 * filter, so the two surfaces agree on the command half and neither re-decides it
 * here.
 */
export function LayerActions({
  bridge,
}: {
  readonly bridge: EditorShellBridge | undefined;
}): React.JSX.Element | null {
  // The chord the tooltips print follows the live binding table, the same way
  // the dock's do: a rebind has to re-render this surface rather than only
  // reach the dispatcher.
  useActiveShortcuts();
  // No bridge is no document, and no selection either. Either way the footer
  // is not a control surface: it is not drawn at all.
  if (bridge === undefined || !hasSelection(bridge.target())) return null;
  const actions = objectActionsFor(bridge);
  return (
    <footer className="editor-shell-pane-actions" data-yunari-layer-actions="">
      {actions.map((action) => {
        // The dock and this footer name the same actions, so they print the
        // same chord — read from the registry here rather than held.
        const shortcut =
          action.shortcut === undefined
            ? undefined
            : {
                printed: shortcutLabel(action.shortcut),
                spoken: shortcutSpokenLabel(action.shortcut),
              };
        return (
          <ControlIconButton
            key={action.id}
            label={action.label}
            {...(shortcut === undefined ? {} : { shortcut })}
            // The mark is the whole mechanism: `destructiveMarker` carries the
            // registry's flag to every surface, and the one
            // `[data-yunari-destructive]` rule in the shell paints it `--hot`.
            // Nothing here says "destructive" a second time.
            data={destructiveMarker(action)}
            onClick={() => bridge.run(action.id)}
          >
            <Glyph icon={action.icon} size={15} />
          </ControlIconButton>
        );
      })}
    </footer>
  );
}
