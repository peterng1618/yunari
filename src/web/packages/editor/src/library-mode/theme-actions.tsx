import type * as React from "react";
import { useState } from "react";
import { confirmOutputBake } from "../components/output-bake-dialog.js";
import { ACTION_BUTTON, Dialog } from "../components/ui/dialog.js";
import { bakeStoredThemeCrops } from "../crop-manager/bake-stored.js";
import { fileNameFor, serializeThemePackage } from "../persist.js";
import { downloadBytes } from "../persistence-manager/index.js";
import type { ThemeLibraryClient } from "../theme-library-client.js";
import { uiCopy } from "../ui-copy.js";

/** The host's refusal in the words it gave, or a string for nothing better. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The two stored-theme commands a library row owns, and the refusal each one
 * draws.
 *
 * Both act on a theme the host holds as a folder: Delete moves that folder to
 * the host's recycle bin, and Export reads the stored document and writes the
 * package the format documents. They are one hook because they share the one
 * fact that makes them safe — the host's answer decides, and a refusal writes
 * nothing and says why.
 */
export function useThemeActions(props: {
  readonly client: ThemeLibraryClient;
  /** Runs after the host accepted a removal, so the page drops the row and
   *  closes whatever showed it. */
  readonly onDeleted: (id: string) => void;
  /** Tells the session the theme is gone, so the open document's stored base
   *  is cleared and the next save does not trust a folder the host trashed. */
  readonly onRemoved?: ((id: string) => void) | undefined;
}): {
  readonly confirmDeleteId: string | undefined;
  readonly deleteRefusal: string | undefined;
  readonly exportRefusal: string | undefined;
  requestDelete(id: string): void;
  cancelDelete(): void;
  confirmDelete(): void;
  exportTheme(id: string): void;
} {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | undefined>(
    undefined,
  );
  const [deleteRefusal, setDeleteRefusal] = useState<string | undefined>(
    undefined,
  );
  const [exportRefusal, setExportRefusal] = useState<string | undefined>(
    undefined,
  );

  const deleteTheme = (id: string): void => {
    const remove = props.client.remove;
    if (remove === undefined) {
      setDeleteRefusal(uiCopy.store.deleteUnavailable);
      return;
    }
    setDeleteRefusal(undefined);
    void remove.call(props.client, id).then(
      () => {
        props.onRemoved?.(id);
        props.onDeleted(id);
      },
      (error: unknown) => {
        setDeleteRefusal(uiCopy.store.deleteFailed(messageOf(error)));
      },
    );
  };

  /**
   * The theme's package, read from the host and written by the same serialiser
   * the document's export uses.
   *
   * The library is a folder rather than an archive, so there is no stored file
   * to hand over: the page opens the stored theme and builds the package the
   * format documents. A refusal writes nothing and says why.
   */
  const exportTheme = (id: string): void => {
    setExportRefusal(undefined);
    void props.client.open(id).then(
      async (content) => {
        const baked = await bakeStoredThemeCrops({
          envelope: content.envelope,
          assets: content.assets,
        });
        if (
          baked.baked > 0 &&
          !(await confirmOutputBake({
            title: uiCopy.file.exportTheme,
            crops: baked.baked,
          }))
        ) {
          return;
        }
        const written = serializeThemePackage(
          baked.envelope,
          baked.assets,
          undefined,
          content.credits,
        );
        if (!written.ok) {
          setExportRefusal(uiCopy.store.exportFailed(written.message));
          return;
        }
        downloadBytes(fileNameFor(baked.envelope), written.bytes);
      },
      (error: unknown) => {
        setExportRefusal(uiCopy.store.exportFailed(messageOf(error)));
      },
    );
  };

  return {
    confirmDeleteId,
    deleteRefusal,
    exportRefusal,
    requestDelete: (id) => setConfirmDeleteId(id),
    cancelDelete: () => setConfirmDeleteId(undefined),
    confirmDelete: () => {
      const id = confirmDeleteId;
      setConfirmDeleteId(undefined);
      if (id !== undefined) deleteTheme(id);
    },
    exportTheme,
  };
}

/**
 * The removal question. **The page drops the row only from the host's
 * acceptance**, and this dialog's own copy says what removal means: the folder
 * moves to the host's recycle bin, so the press is recoverable and never an
 * unlink.
 */
export function DeleteThemeDialog(props: {
  readonly open: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}): React.JSX.Element {
  return (
    <Dialog
      open={props.open}
      onOpenChange={(next) => {
        if (!next) props.onCancel();
      }}
      label={uiCopy.store.deleteConfirm.title}
      closeLabel={uiCopy.store.deleteConfirm.cancel}
      className="editor-shell-dialog--delete-theme"
    >
      <div
        data-yunari-library-delete-dialog=""
        className="flex w-[var(--import-dialog-width)] flex-col gap-[var(--space-12)]"
      >
        <p className="m-0 text-sm text-text">
          {uiCopy.store.deleteConfirm.note}
        </p>
        <div className="flex flex-wrap justify-end gap-[var(--space-6)]">
          <button
            type="button"
            data-yunari-library-delete-cancel=""
            className={ACTION_BUTTON}
            onClick={props.onCancel}
          >
            {uiCopy.store.deleteConfirm.cancel}
          </button>
          <button
            type="button"
            data-yunari-library-delete-confirm=""
            data-yunari-destructive=""
            className={ACTION_BUTTON}
            onClick={props.onConfirm}
          >
            {uiCopy.store.deleteConfirm.confirm}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
