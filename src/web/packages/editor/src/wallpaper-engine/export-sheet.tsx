import type * as React from "react";
import { useEffect, useState } from "react";
import { uiCopy } from "../ui-copy.js";
import {
  EXPORT_POLL_MS,
  type ExportFile,
  fetchExport,
  findExports,
  type StartMobileExportAnswer,
  type StartProjectAnswer,
  startMobileExport,
  startProject,
  type WallpaperEngineClientOptions,
  type WallpaperEngineItem,
} from "./client.js";

/** The import the sheet hands the session: a file in, or the session's own
 *  refusal sentence out. */
export type WallpaperExportOutcome =
  | { readonly ok: true; readonly assetId: string }
  | { readonly ok: false; readonly message: string };

/** The newest offered file: the mobile export writes one video, and the sheet
 *  never has to choose a format. */
function newestOf(files: readonly ExportFile[]): ExportFile | undefined {
  let newest: ExportFile | undefined;
  for (const file of files) {
    if (newest === undefined || file.modified > newest.modified) newest = file;
  }
  return newest;
}

/** A scene's export sheet, rendered in the finder's own body in place of the
 *  list. It never imports by itself: the watcher only offers the file the
 *  author just exported.
 *
 *  `since` is the mount time, not the tick's, so a file written before the
 *  sheet opened is never offered as this export. */
export function ExportSheet(props: {
  readonly item: WallpaperEngineItem;
  readonly onImportFile: (file: File) => Promise<WallpaperExportOutcome>;
  readonly onImported: (assetId: string) => void;
  readonly onDone: () => void;
  readonly client?: WallpaperEngineClientOptions;
}): React.JSX.Element {
  const { item, onImportFile, onImported, onDone, client } = props;
  const copy = uiCopy.assets.wallpaperEngine.scene;
  const [since] = useState(() => Date.now());
  const [offer, setOffer] = useState<ExportFile | undefined>();
  const [exported, setExported] = useState<
    StartMobileExportAnswer | undefined
  >();
  const [exporting, setExporting] = useState(false);
  const [opened, setOpened] = useState<StartProjectAnswer | undefined>();
  const [opening, setOpening] = useState(false);
  const [importing, setImporting] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>();
  const [watcherStopped, setWatcherStopped] = useState(false);

  useEffect(() => {
    if (watcherStopped) return;
    let live = true;

    const poll = async (): Promise<void> => {
      const files = await findExports(since, client);
      if (!live) return;
      const newest = newestOf(files);
      if (newest === undefined) return;
      setOffer((current) => (current?.name === newest.name ? current : newest));
    };

    void poll();
    const timer = setInterval(() => {
      void poll();
    }, EXPORT_POLL_MS);

    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [since, client, watcherStopped]);

  const open = async (): Promise<void> => {
    setOpening(true);
    setOpened(await startProject(item.workshopId, client));
    setOpening(false);
  };

  const exportForMobile = async (): Promise<void> => {
    setExporting(true);
    setExported(await startMobileExport(item.workshopId, client));
    setExporting(false);
  };

  const importOffer = async (file: ExportFile): Promise<void> => {
    setImporting(true);
    const fetched = await fetchExport(file.name, client);
    if (fetched === undefined) {
      setRefusal(uiCopy.assets.bytesUnavailable(file.name));
      setImporting(false);
      return;
    }

    const outcome = await onImportFile(fetched);
    setImporting(false);
    if (!outcome.ok) {
      setRefusal(outcome.message);
      return;
    }

    // Stop the watcher before the caller drops the sheet, so a poll already in
    // flight cannot offer the file again.
    setWatcherStopped(true);
    onImported(outcome.assetId);
  };

  return (
    <div
      data-yunari-export-sheet=""
      className="flex flex-col gap-[var(--space-10)]"
    >
      <div className="flex items-center justify-between gap-[var(--space-10)]">
        <span className="truncate text-sm">{copy.title(item.title)}</span>
        <button
          type="button"
          data-yunari-export-done=""
          onClick={onDone}
          className="shrink-0 rounded-[var(--radius-sm)] border border-edge px-[var(--space-10)] py-[var(--space-6)] text-xs"
        >
          {copy.back}
        </button>
      </div>

      <p data-yunari-export-mobile-step="" className="text-xs text-muted">
        {copy.mobileStep}
      </p>

      {item.hasText === true ? (
        <p data-yunari-export-text-step="" className="text-xs text-muted">
          {copy.textStep}
        </p>
      ) : null}

      <button
        type="button"
        data-yunari-export-mobile=""
        disabled={exporting}
        onClick={() => {
          void exportForMobile();
        }}
        className="self-start rounded-[var(--radius-sm)] border border-edge px-[var(--space-10)] py-[var(--space-6)] text-sm"
      >
        {exporting ? copy.mobileRunning : copy.mobile}
      </button>

      {exported?.ok === false ? (
        <p data-yunari-export-mobile-refusal="" className="text-xs text-muted">
          {exported.reason === "agreement"
            ? copy.mobileAgreement
            : copy.mobileRefused(exported.reason)}
        </p>
      ) : null}
      {exported?.ok === true ? (
        <p data-yunari-export-mobile-save="" className="text-xs text-muted">
          {copy.mobileSave}
        </p>
      ) : null}

      {offer === undefined ? null : (
        <div
          data-yunari-export-offer=""
          className="flex flex-col gap-[var(--space-6)] rounded-[var(--radius-md)] border border-edge bg-[var(--panel-2)] p-[var(--space-8)]"
        >
          <span className="text-xs text-muted">{copy.offer(offer.name)}</span>
          <button
            type="button"
            data-yunari-export-import=""
            disabled={importing}
            onClick={() => {
              void importOffer(offer);
            }}
            className="self-start rounded-[var(--radius-sm)] border border-edge px-[var(--space-10)] py-[var(--space-6)] text-sm"
          >
            {uiCopy.assets.wallpaperEngine.import}
          </button>
        </div>
      )}

      {refusal === undefined ? null : (
        <p data-yunari-export-import-refusal="" className="text-xs text-muted">
          {refusal}
        </p>
      )}

      <div className="flex flex-col gap-[var(--space-6)]">
        <p className="text-xs text-muted">{copy.projectNotice}</p>
        <button
          type="button"
          data-yunari-export-open=""
          disabled={opening}
          onClick={() => {
            void open();
          }}
          className="self-start rounded-[var(--radius-sm)] border border-edge px-[var(--space-10)] py-[var(--space-6)] text-sm"
        >
          {opening ? copy.opening : uiCopy.assets.wallpaperEngine.openScene}
        </button>
        {opened?.ok === false ? (
          <p data-yunari-export-refusal="" className="text-xs text-muted">
            {copy.refused(opened.reason)}
          </p>
        ) : null}
        {opened?.ok === true ? (
          <p data-yunari-export-project="" className="text-xs text-muted">
            {copy.ready(opened.name)}
          </p>
        ) : null}
      </div>
    </div>
  );
}
