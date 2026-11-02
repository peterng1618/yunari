import type * as React from "react";
import { ACTION_BUTTON, Dialog } from "../../components/ui/dialog.js";
import { uiCopy } from "../../ui-copy.js";

/**
 * The choice a just-declared picture makes: put it on the canvas, or make it
 * the artboard's background. Both are one press, and neither is implied by the
 * kind — an author importing a texture wants the background, one importing a
 * logo wants the object — so the file is declared first and the destination is
 * asked rather than assumed.
 *
 * A pane mounted without a document has no background write, so it offers only
 * the placement it can perform.
 */
export interface PlaceImageModalProps {
  readonly name: string;
  readonly previewUrl?: string;
  readonly onPlace: () => void;
  readonly onBackground?: (() => void) | undefined;
  readonly onClose: () => void;
}

export function PlaceImageModal({
  name,
  previewUrl,
  onPlace,
  onBackground,
  onClose,
}: PlaceImageModalProps): React.JSX.Element {
  const copy = uiCopy.panels.placeImage;
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      label={copy.title}
      closeLabel={copy.close}
    >
      <div
        data-yunari-place-image-modal=""
        className="flex w-[var(--import-dialog-width)] flex-col gap-[var(--space-8)]"
      >
        <span className="truncate text-xs text-muted">{name}</span>
        {previewUrl === undefined ? null : (
          <img
            src={previewUrl}
            alt=""
            className="max-h-[var(--place-image-preview-height)] w-full rounded-[var(--radius-md)] border border-edge-2 bg-panel-2 object-contain"
          />
        )}
        <div className="flex items-center justify-end gap-[var(--space-6)]">
          {onBackground === undefined ? null : (
            <button
              type="button"
              data-yunari-place-image-background=""
              className={ACTION_BUTTON}
              onClick={onBackground}
            >
              {copy.background}
            </button>
          )}
          <button
            type="button"
            data-yunari-place-image-canvas=""
            className={ACTION_BUTTON}
            onClick={onPlace}
          >
            {copy.place}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
