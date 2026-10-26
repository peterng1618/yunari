import { createElement, useState } from "react";
import type { LocalAssetReference } from "../asset-manager/index.js";
import { AssetMark } from "../panes/assets/asset-card.js";
import { uiCopy } from "../ui-copy.js";
import { ACTION_BUTTON, Dialog } from "./ui/dialog.js";
import { type ModalSettle, openModal } from "./ui/modal-host.js";

/** What the cleanup question can answer. A dismissal is `cancel`, so a closed
 *  dialog is never read as permission to remove a file. */
export type SaveCleanupAnswer = "remove" | "keep" | "cancel";

export interface SaveCleanupFile {
  readonly name: string;
  readonly kind: LocalAssetReference["kind"];
  readonly sizeBytes: number;
  /** Why nothing holds it: "not on the canvas", "no type token refers to it",
   *  "not the background". One sentence per kind, from one owner. */
  readonly reason: string;
  /** The manager's own blob URL, so a picture wears the same thumbnail here as
   *  on its Assets card. */
  readonly previewUrl?: string;
}

/** The one place a byte count becomes a reading. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SaveCleanupDialog({
  title,
  documentName,
  files,
  themeBytes,
  settle,
}: {
  readonly title: string;
  /** The document being saved; absent for a document that never named itself,
   *  in which case the line is not drawn at all. */
  readonly documentName?: string;
  readonly files: readonly SaveCleanupFile[];
  readonly themeBytes: number;
  readonly settle: ModalSettle<SaveCleanupAnswer>;
}): React.JSX.Element {
  // Off by default: a theme in progress may still want the file it has not
  // wired yet, and the drawing's own caption says the theme is saved either way.
  const [remove, setRemove] = useState(false);
  const unusedBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) settle.dismiss();
      }}
      label={title}
    >
      <p className="editor-shell-dialog-lead">{title}</p>
      {documentName === undefined ? null : (
        <p className="mb-[var(--space-8)] text-2xs text-muted">
          {`${documentName} · ${title}`}
        </p>
      )}
      <div className="mb-[var(--space-6)] flex items-baseline gap-[var(--space-8)]">
        <span className="text-2xs font-semibold tracking-[0.11em] text-faint uppercase">
          {uiCopy.saveCleanup.heading}
        </span>
        <span className="font-mono text-[10px] text-faint">
          {uiCopy.saveCleanup.count(files.length, formatBytes(unusedBytes))}
        </span>
        <span className="h-px flex-1 bg-edge-2" />
      </div>
      <ul className="flex flex-col gap-[var(--space-4)]">
        {files.map((file) => (
          <li
            key={`${file.name}\n${file.kind}`}
            className="flex items-center gap-[var(--space-8)] rounded-[var(--radius-sm)] border border-edge-2 bg-panel-2 p-[var(--space-6)]"
          >
            <AssetMark
              kind={file.kind}
              {...(file.previewUrl === undefined
                ? {}
                : { previewUrl: file.previewUrl })}
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-xs text-text">{file.name}</span>
              <span className="truncate font-mono text-[10px] text-muted">
                {`${uiCopy.panels.assetCard.kind[file.kind]} · ${formatBytes(file.sizeBytes)} · ${file.reason}`}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p className="pt-[var(--space-6)] text-[10px] text-faint">
        {uiCopy.saveCleanup.note}
      </p>
      <label className="flex items-start gap-[var(--space-8)] pt-[var(--space-10)]">
        <input
          type="checkbox"
          checked={remove}
          data-yunari-save-cleanup-remove=""
          onChange={(event) => setRemove(event.target.checked)}
          className="size-4 flex-none accent-accent"
        />
        <span className="flex flex-col">
          <span className="text-xs text-text">
            {uiCopy.saveCleanup.removeAfterSave(files.length)}
          </span>
          <span className="text-[10px] text-warn">
            {uiCopy.saveCleanup.warning}
          </span>
        </span>
      </label>
      <div className="mt-[var(--space-10)] flex items-center gap-[var(--space-8)] border-t border-edge pt-[var(--space-8)]">
        <span className="font-mono text-[10px] text-faint">
          {uiCopy.saveCleanup.sizes(
            formatBytes(themeBytes),
            formatBytes(unusedBytes),
          )}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          className={ACTION_BUTTON}
          onClick={() => settle.close("cancel")}
        >
          {uiCopy.saveCleanup.cancel}
        </button>
        <button
          type="button"
          className={ACTION_BUTTON}
          onClick={() => settle.close(remove ? "remove" : "keep")}
        >
          {title}
        </button>
      </div>
    </Dialog>
  );
}

/**
 * Asks what an author wants done about the files nothing holds, before a save
 * writes the document they are not part of.
 *
 * The answer is the save's own vocabulary rather than the checkbox's: `keep`
 * and `cancel` both leave the files alone, and only `cancel` stops the save.
 * The title is the save the author pressed, so the same sheet serves both save
 * flows with the words they used to open it.
 */
export async function confirmSaveCleanup(input: {
  /** The save the author pressed: `uiCopy`'s own "Save to library" or
   *  "Save package". */
  readonly title: string;
  /** The document's name, drawn under the save's title; absent when it has
   *  none. */
  readonly documentName?: string;
  readonly files: readonly SaveCleanupFile[];
  /** The size of the theme being saved, without the unused files. */
  readonly themeBytes: number;
}): Promise<SaveCleanupAnswer> {
  const answer = await openModal<SaveCleanupAnswer>((settle) =>
    createElement(SaveCleanupDialog, { ...input, settle }),
  );
  return answer ?? "cancel";
}
