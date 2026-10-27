import { createElement, useState } from "react";
import type { FontMetadata } from "../asset-manager/font-metadata.js";
import { FontMetadataForm } from "../panes/assets/font-metadata-form.js";
import { uiCopy } from "../ui-copy.js";
import { Dialog } from "./ui/dialog.js";
import { type ModalSettle, openModal } from "./ui/modal-host.js";

/** What a commit answered: a refusal keeps the form open with its words. */
export interface FontImportOutcome {
  readonly ok: boolean;
  readonly message: string;
}

export type FontImportCommit = (
  metadata: FontMetadata,
) => Promise<FontImportOutcome>;

/**
 * The token inspector's import flow: one picked local file, its metadata, and
 * the same two answers the Assets pane's form gives — Create declares the file
 * with a token, Cancel declares it without one.
 *
 * The form draws no role select: a token's family is chosen here, and a role's
 * id is the role, so this import may never rewrite one.
 */
export function FontImportDialog(props: {
  readonly filename: string;
  readonly initial: FontMetadata;
  readonly onCommit: FontImportCommit;
  readonly onCancel: FontImportCommit;
  readonly settle: ModalSettle<void>;
}): React.JSX.Element {
  const { filename, initial, onCommit, onCancel, settle } = props;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async (
    metadata: FontMetadata,
    commit: FontImportCommit,
  ): Promise<void> => {
    setBusy(true);
    let closed = false;
    try {
      const outcome = await commit(metadata);
      if (!outcome.ok) {
        // The form stays open, so the values it refuses can be repaired.
        setMessage(outcome.message);
        return;
      }
      // The dialog is unmounted by this call; nothing may write state after it.
      closed = true;
      settle.close(undefined);
    } catch (error) {
      // A commit that rejects is a refusal too: the form stays open and says
      // why, rather than sitting busy over an answer that never arrived.
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      // A rejecting commit must not leave the form busy forever; a closed one
      // must not be written to at all.
      if (!closed) setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) settle.dismiss();
      }}
      label={uiCopy.panels.importLocalFont}
    >
      <p className="editor-shell-dialog-lead">
        {uiCopy.panels.importLocalFont}
      </p>
      <FontMetadataForm
        filename={filename}
        initial={initial}
        busy={busy}
        showRole={false}
        onEdit={() => setMessage("")}
        onCommit={(metadata) => {
          void submit(metadata, onCommit);
        }}
        onCancel={(metadata) => {
          void submit(metadata, onCancel);
        }}
      />
      {message === "" ? null : (
        <p role="alert" className="text-xs text-warn">
          {message}
        </p>
      )}
    </Dialog>
  );
}

/** Opens the dialog on its own host and resolves when it closes. */
export async function openFontImportDialog(input: {
  readonly filename: string;
  readonly initial: FontMetadata;
  readonly onCommit: FontImportCommit;
  readonly onCancel: FontImportCommit;
}): Promise<void> {
  await openModal<void>((settle) =>
    createElement(FontImportDialog, { ...input, settle }),
  );
}
