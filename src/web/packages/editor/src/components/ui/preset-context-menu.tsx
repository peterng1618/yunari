import { ContextMenu } from "@base-ui/react/context-menu";
import { useMemo } from "react";
import { destructiveMarker } from "../../object-actions.js";
import { uiCopy } from "../../ui-copy.js";

/** Which library the row belongs to, and where the menu was asked for. */
export type PresetMenuTarget = {
  readonly kind: "colour" | "gradient";
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
};

/**
 * The preset library's delete menu.
 *
 * A controlled `ContextMenu.Root` with no `Trigger`, anchored to a zero-sized
 * rect at the gesture — the shape `editor-shell/canvas-context-menu.tsx` uses,
 * and for the same reason: the menu is opened by a right-click or a key on a
 * row that already owns its own handlers, so a trigger would be a second thing
 * listening to the same gesture.
 */
export function PresetContextMenu({
  target,
  onClose,
  onDelete,
}: {
  readonly target: PresetMenuTarget | undefined;
  readonly onClose: () => void;
  readonly onDelete: (target: PresetMenuTarget) => void;
}): React.JSX.Element {
  const anchor = useMemo(
    () => ({
      getBoundingClientRect: (): DOMRect =>
        DOMRect.fromRect({
          x: target?.x ?? 0,
          y: target?.y ?? 0,
          width: 0,
          height: 0,
        }),
    }),
    [target],
  );

  return (
    <ContextMenu.Root
      open={target !== undefined}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <ContextMenu.Portal>
        <ContextMenu.Positioner
          anchor={anchor}
          className="editor-shell-positioner"
        >
          <ContextMenu.Popup className="editor-shell-menu-popup">
            <ContextMenu.Item
              data-testid="preset-menu-delete"
              {...destructiveMarker({ destructive: true })}
              onClick={() => {
                if (target !== undefined) onDelete(target);
              }}
            >
              {uiCopy.panels.presetDelete}
            </ContextMenu.Item>
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
