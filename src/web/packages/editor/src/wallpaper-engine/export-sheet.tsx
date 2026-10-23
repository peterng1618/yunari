import type * as React from "react";
import { useEffect, useState } from "react";
import { uiCopy } from "../ui-copy.js";
import {
  EXPORT_POLL_MS,
  type ExportFile,
  fetchExport,
  findExports,
  type StartProjectAnswer,
  startProject,
  type WallpaperEngineClientOptions,
  type WallpaperEngineItem,
} from "./client.js";

/** The import the sheet hands the session: a file in, or the session's own
 *  refusal sentence out. */
export type WallpaperExportOutcome =
  | { readonly ok: true; readonly assetId: string }
  | { readonly ok: false; readonly message: string };

/** What the author should export for this scene. Only a scene the listing
 *  classed as still-at-rest is offered as a PNG; an unclassified one is never
 *  guessed still, because a moving scene exported as one frame loses the work. */
export function exportSettingsOf(item: WallpaperEngineItem):
  | { readonly format: "png"; readonly width: 1920; readonly height: 1080 }
  | {
      readonly format: "mp4";
      readonly width: 1920;
      readonly height: 1080;
      readonly fps: 30;
      readonly durationSeconds: 5;
      readonly blendSeconds: 1;
    } {
  return item.stillAtRest === true
    ? { format: "png", width: 1920, height: 1080 }
    : {
        format: "mp4",
        width: 1920,
        height: 1080,
        fps: 30,
        durationSeconds: 5,
        blendSeconds: 1,
      };
}

/** The newest offered file whose format the settings ask for. */
function newestOf(
  files: readonly ExportFile[],
  format: ExportFile["format"],
): ExportFile | undefined {
  let newest: ExportFile | undefined;
  for (const file of files) {
    if (file.format !== format) continue;
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
  const settings = exportSettingsOf(item);
  const format = settings.format;
  const copy = uiCopy.assets.wallpaperEngine.scene;
  const [since] = useState(() => Date.now());
  const [offer, setOffer] = useState<ExportFile | undefined>();
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
      const newest = newestOf(files, format);
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
  }, [since, format, client, watcherStopped]);

  const open = async (): Promise<void> => {
    setOpening(true);
    setOpened(await startProject(item.workshopId, client));
    setOpening(false);
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

      <ol className="flex list-decimal flex-col gap-[var(--space-8)] pl-[var(--space-16)] text-xs text-muted">
        {item.hasText === true ? (
          <li data-yunari-export-text-step="">{copy.deleteText}</li>
        ) : null}
        <li data-yunari-export-format-step="">
          {copy.exportStep}
          <dl
            data-yunari-export-format={format}
            className="mt-[var(--space-4)] grid grid-cols-[auto_1fr] gap-x-[var(--space-10)] gap-y-[var(--space-2)]"
          >
            <dt>{copy.formatField}</dt>
            <dd data-yunari-export-format-name="">{copy.formatName[format]}</dd>
            <dt>{copy.resolutionField}</dt>
            <dd data-yunari-export-resolution="">
              {copy.resolution(settings.width, settings.height)}
            </dd>
            {settings.format === "mp4" ? (
              <>
                <dt>{copy.frameRateField}</dt>
                <dd data-yunari-export-fps="">
                  {copy.perSecond(settings.fps)}
                </dd>
                <dt>{copy.clipField}</dt>
                <dd data-yunari-export-duration="">
                  {copy.seconds(settings.durationSeconds)}
                </dd>
                <dt>{copy.blendField}</dt>
                <dd data-yunari-export-blend="">
                  {copy.seconds(settings.blendSeconds)}
                </dd>
              </>
            ) : null}
          </dl>
        </li>
        <li data-yunari-export-project-notice="">{copy.projectNotice}</li>
      </ol>

      <p data-yunari-export-elsewhere="" className="text-xs text-muted">
        {copy.elsewhere}
      </p>

      <div className="flex flex-col gap-[var(--space-6)]">
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
            {opened.launched
              ? copy.launched(opened.name)
              : copy.ready(opened.name)}
          </p>
        ) : null}
      </div>

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
    </div>
  );
}
