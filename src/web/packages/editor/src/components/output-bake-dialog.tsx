import { createElement } from "react";
import { uiCopy } from "../ui-copy.js";
import { ACTION_BUTTON, Dialog } from "./ui/dialog.js";
import { type ModalSettle, openModal } from "./ui/modal-host.js";

function OutputBakeDialog({
  title,
  crops,
  settle,
}: {
  readonly title: string;
  readonly crops: number;
  readonly settle: ModalSettle<boolean>;
}): React.JSX.Element {
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) settle.dismiss();
      }}
      label={title}
    >
      <p className="editor-shell-dialog-lead">
        {uiCopy.outputBake.title(title)}
      </p>
      <p className="mb-[var(--space-8)] text-xs text-muted">
        {uiCopy.outputBake.body(crops)}
      </p>
      <p className="text-[10px] text-faint">{uiCopy.outputBake.note}</p>
      <div className="mt-[var(--space-10)] flex items-center justify-end gap-[var(--space-8)] border-t border-edge pt-[var(--space-8)]">
        <button
          type="button"
          className={ACTION_BUTTON}
          onClick={() => settle.close(false)}
        >
          {uiCopy.outputBake.cancel}
        </button>
        <button
          type="button"
          className={ACTION_BUTTON}
          onClick={() => settle.close(true)}
        >
          {uiCopy.outputBake.confirm}
        </button>
      </div>
    </Dialog>
  );
}

/**
 * Warns that an export or store submission flattens every authored crop and
 * leaves the pixels outside it out of that copy. The library document is not
 * changed, so the crop stays editable there.
 */
export async function confirmOutputBake(input: {
  readonly title: string;
  readonly crops: number;
}): Promise<boolean> {
  const answer = await openModal<boolean>((settle) =>
    createElement(OutputBakeDialog, { ...input, settle }),
  );
  return answer === true;
}
