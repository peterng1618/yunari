import type * as React from "react";
import { useEffect, useState } from "react";
import { uiCopy } from "../ui-copy.js";
import {
  fetchWallpaperEngine,
  type WallpaperEngineAnswer,
  type WallpaperEngineClientOptions,
  type WallpaperEngineItem,
} from "../wallpaper-engine/client.js";
import {
  ExportSheet,
  type WallpaperExportOutcome,
} from "../wallpaper-engine/export-sheet.js";
import type { ImportOutcome } from "./actions.js";

/** The finder's Wallpaper Engine body: this PC's library, not a search.
 *
 * The import itself is the session's — this body only says which item, because
 * the asset manager's caps and the credit are not something a row can own. A
 * scene row opens the export sheet in place of the list; the sheet's own import
 * goes through the same session transaction an image row's does. */
export function WallpaperEngineBody(props: {
  readonly onImport: (item: WallpaperEngineItem) => Promise<ImportOutcome>;
  readonly onImportExport: (
    item: WallpaperEngineItem,
    file: File,
  ) => Promise<WallpaperExportOutcome>;
  readonly client?: WallpaperEngineClientOptions;
}): React.JSX.Element {
  const client = props.client;
  const onImport = props.onImport;
  const onImportExport = props.onImportExport;
  const [answer, setAnswer] = useState<WallpaperEngineAnswer | undefined>();
  const [refusals, setRefusals] = useState<Readonly<Record<string, string>>>(
    {},
  );
  const [selected, setSelected] = useState<WallpaperEngineItem | undefined>();
  /** §5.3's title search and kind filter. The listing is already in memory, so
   *  narrowing it is this body's own decision and no new route. */
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<WallpaperEngineItem["kind"] | "all">("all");
  /** §4.1: said once, after a successful image or video import; a refusal and a
   *  scene export never raise it. */
  const [noticed, setNoticed] = useState(false);

  useEffect(() => {
    let live = true;
    void fetchWallpaperEngine(client).then((next) => {
      if (live) setAnswer(next);
    });
    return () => {
      live = false;
    };
  }, [client]);

  if (answer === undefined) return <></>;

  if (answer.available === false) {
    return (
      <p
        data-yunari-wallpaper-engine-unavailable=""
        className="text-sm text-muted"
      >
        {uiCopy.assets.wallpaperEngine.reason[answer.reason]}
      </p>
    );
  }

  if (answer.items.length === 0) {
    return (
      <p className="text-sm text-muted">
        {uiCopy.assets.wallpaperEngine.empty}
      </p>
    );
  }

  // The sheet replaces the list while a scene is chosen: the export is the
  // whole of that choice, and `onDone` is the way back to the library.
  if (selected !== undefined) {
    return (
      <ExportSheet
        item={selected}
        onImportFile={(file) => onImportExport(selected, file)}
        onImported={() => {
          setSelected(undefined);
        }}
        onDone={() => {
          setSelected(undefined);
        }}
        {...(client === undefined ? {} : { client })}
      />
    );
  }

  const importItem = async (item: WallpaperEngineItem): Promise<void> => {
    const outcome = await onImport(item);
    setRefusals((current) => {
      const next = { ...current };
      if (outcome.ok) delete next[item.workshopId];
      else next[item.workshopId] = outcome.message;
      return next;
    });
    if (outcome.ok) setNoticed(true);
  };

  const copy = uiCopy.assets.wallpaperEngine;
  const needle = query.trim().toLowerCase();
  const shown = answer.items.filter(
    (item) =>
      (kind === "all" || item.kind === kind) &&
      (needle === "" || item.title.toLowerCase().includes(needle)),
  );

  return (
    <div className="flex flex-col gap-[var(--space-8)]">
      <input
        type="text"
        data-yunari-wallpaper-engine-search=""
        aria-label={copy.search}
        placeholder={copy.search}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
        className="rounded-[var(--radius-sm)] border border-edge bg-[var(--panel-2)] px-[var(--space-8)] py-[var(--space-6)] text-sm"
      />
      <div
        role="group"
        aria-label={copy.filterKind}
        className="flex flex-wrap gap-[var(--space-6)]"
      >
        {(["all", "image", "video", "web", "scene"] as const).map((option) => (
          <button
            key={option}
            type="button"
            data-yunari-wallpaper-engine-kind-filter={option}
            aria-pressed={kind === option}
            onClick={() => {
              setKind(option);
            }}
            className="rounded-[var(--radius-sm)] border border-edge px-[var(--space-10)] py-[var(--space-6)] text-xs"
          >
            {option === "all" ? copy.filterAll : copy.kind[option]}
          </button>
        ))}
      </div>
      {noticed ? (
        <p
          data-yunari-wallpaper-engine-image-notice=""
          className="text-xs text-muted"
        >
          {copy.imageNotice}
        </p>
      ) : null}
      {shown.length === 0 ? (
        <p
          data-yunari-wallpaper-engine-no-matches=""
          className="text-sm text-muted"
        >
          {copy.noMatches}
        </p>
      ) : null}
      {shown.map((item) => {
        const refusal = refusals[item.workshopId];
        return (
          <div
            key={item.workshopId}
            data-yunari-wallpaper-engine-item={item.workshopId}
            className="flex items-center gap-[var(--space-10)] rounded-[var(--radius-md)] border border-edge bg-[var(--panel-2)] p-[var(--space-8)]"
          >
            {item.previewUrl === undefined ? null : (
              <img
                src={item.previewUrl}
                alt=""
                loading="lazy"
                className="h-16 w-24 shrink-0 rounded-[var(--radius-sm)] object-cover"
              />
            )}
            <span className="flex min-w-0 flex-1 flex-col gap-[var(--space-2)]">
              <span className="truncate text-sm">{item.title}</span>
              <span className="text-xs text-muted">
                {uiCopy.assets.wallpaperEngine.kind[item.kind]} ·{" "}
                {uiCopy.assets.wallpaperEngine.size(item.filesize)}
              </span>
              {refusal === undefined ? null : (
                <span
                  data-yunari-wallpaper-engine-refusal=""
                  className="text-xs text-muted"
                >
                  {refusal}
                </span>
              )}
            </span>
            {item.kind === "image" || item.kind === "video" ? (
              <button
                type="button"
                data-yunari-wallpaper-engine-import=""
                onClick={() => {
                  void importItem(item);
                }}
                className="shrink-0 rounded-[var(--radius-sm)] border border-edge px-[var(--space-10)] py-[var(--space-6)] text-sm"
              >
                {uiCopy.assets.wallpaperEngine.import}
              </button>
            ) : item.kind === "scene" ? (
              <button
                type="button"
                data-yunari-wallpaper-engine-open=""
                onClick={() => {
                  setSelected(item);
                }}
                className="shrink-0 rounded-[var(--radius-sm)] border border-edge px-[var(--space-10)] py-[var(--space-6)] text-sm"
              >
                {uiCopy.assets.wallpaperEngine.openScene}
              </button>
            ) : item.kind === "web" ? (
              <span className="shrink-0 text-xs text-muted">
                {uiCopy.assets.wallpaperEngine.webUnsupported}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
