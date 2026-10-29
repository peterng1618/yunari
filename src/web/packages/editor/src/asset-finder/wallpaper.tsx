import type { VideoTrimRange } from "@yunari/theme-package";
import type * as React from "react";
import { useRef, useState } from "react";
import { ControlIconButton } from "../components/ui/control-icon-button.js";
import {
  Glyph,
  INFO_GLYPH,
  INSTALL_ITEM_GLYPH,
  REFRESH_GLYPH,
} from "../editor-shell/icons.js";
import {
  ImportVideoModal,
  type VideoImportStep,
} from "../panes/assets/import-video-modal.js";
import { uiCopy } from "../ui-copy.js";
import type {
  StartProjectAnswer,
  WallpaperEngineItem,
} from "../wallpaper-engine/client.js";
import type { ImportOutcome } from "./actions.js";
import type { FinderCardModel } from "./finder-card.js";
import type { FinderAction } from "./finder-controls.js";
import { WallpaperEngineGuide } from "./wallpaper-engine-guide.js";

/**
 * The finder's Wallpaper Engine pane, minus the frame: the listing is a
 * library rather than a search, so the pane maps items to the one card every
 * tab draws and declares each card's one write. The shell owns the fetch, the
 * filter and the action lifecycle; this module owns the words and the tools.
 */

/** The session's three writes. A host that wires none offers a read-only
 *  library: the cards still draw, and no action claims to run. */
export interface WallpaperActions {
  readonly onSetBackground: (
    item: WallpaperEngineItem,
    trim?: VideoTrimRange,
  ) => Promise<ImportOutcome>;
  readonly onConvert: (
    item: WallpaperEngineItem,
  ) => Promise<StartProjectAnswer>;
  readonly onImportPackage: (
    file: File,
    onStep: (step: VideoImportStep) => void,
  ) => Promise<ImportOutcome>;
}

function words() {
  return uiCopy.assets.wallpaperEngine;
}

export function wallpaperCards(
  items: readonly WallpaperEngineItem[],
): readonly FinderCardModel[] {
  const copy = words();
  return items.map((item) => ({
    id: item.workshopId,
    name: item.title,
    meta: `${copy.kind[item.kind]} · ${copy.size(item.filesize)}`,
    licence: undefined,
    sourceId: "wallpaper-engine",
    sourceLabel: "Steam",
    preview:
      item.previewUrl === undefined ? null : (
        <img
          src={item.previewUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      ),
    // A video is what the preview modal plays; a scene is a picture of one.
    previewable: true,
  }));
}

/** The item's one write, named for what it actually does. A scene unpacks into
 *  a local project — no editor process starts — so the label says that rather
 *  than promising an open. */
export function wallpaperActionsOf(
  item: WallpaperEngineItem | undefined,
  actions: WallpaperActions | undefined,
  trim?: VideoTrimRange,
): readonly FinderAction[] {
  if (item === undefined || actions === undefined) return [];
  const copy = words();

  if (item.kind === "video") {
    return [
      {
        id: "set-background",
        label: copy.action.video.idle,
        busyLabel: copy.action.video.running,
        tone: "plain",
        disabled: false,
        run: async () => {
          const outcome =
            trim === undefined
              ? await actions.onSetBackground(item)
              : await actions.onSetBackground(item, trim);
          return outcome.ok
            ? { ok: true, message: copy.backgroundSet(item.title) }
            : outcome;
        },
      },
    ];
  }

  return [
    {
      id: "convert-scene",
      label: copy.action.scene.idle,
      busyLabel: copy.action.scene.running,
      tone: "plain",
      disabled: false,
      run: async () => {
        const project = await actions.onConvert(item);
        return project.ok
          ? {
              ok: true,
              message: project.reused
                ? copy.projectReused(project.name)
                : copy.projectReady(project.name),
            }
          : { ok: false, message: copy.projectFailed(project.reason) };
      },
    },
  ];
}

/**
 * The pane's two controls that need no listing: the workflow guide, and the
 * `.mpkg` a scene exported on another machine already produced. Both stay in
 * the toolbar, so a listing that lands — or an author who scrolls — never
 * remounts the import modal and re-runs a package import.
 */
export function WallpaperTools(props: {
  readonly onImportPackage: WallpaperActions["onImportPackage"] | undefined;
  readonly onRefresh?: (() => void) | undefined;
  readonly onStatus: (message: string) => void;
}): React.JSX.Element {
  const { onImportPackage, onRefresh, onStatus } = props;
  const copy = words();
  const [guideOpen, setGuideOpen] = useState(false);
  const [packageFile, setPackageFile] = useState<File | undefined>();
  const packageInput = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-none items-center gap-[var(--space-4)]">
      {onRefresh === undefined ? null : (
        <ControlIconButton
          label={copy.refresh}
          data={{ "data-yunari-wallpaper-engine-refresh": "" }}
          onClick={onRefresh}
        >
          <Glyph icon={REFRESH_GLYPH} size={14} />
        </ControlIconButton>
      )}
      {onImportPackage === undefined ? null : (
        <>
          <ControlIconButton
            label={copy.importPackage}
            data={{ "data-yunari-wallpaper-engine-import-package": "" }}
            onClick={() => {
              packageInput.current?.click();
            }}
          >
            <Glyph icon={INSTALL_ITEM_GLYPH} size={14} />
          </ControlIconButton>
          <input
            ref={packageInput}
            type="file"
            accept=".mpkg"
            data-yunari-wallpaper-engine-package-input=""
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file !== undefined) setPackageFile(file);
            }}
          />
        </>
      )}
      <ControlIconButton
        label={copy.guide}
        data={{ "data-yunari-wallpaper-engine-guide": "" }}
        onClick={() => {
          setGuideOpen(true);
        }}
      >
        <Glyph icon={INFO_GLYPH} size={14} />
      </ControlIconButton>
      <WallpaperEngineGuide
        open={guideOpen}
        onOpenChange={(next) => {
          setGuideOpen(next);
        }}
      />
      {packageFile === undefined || onImportPackage === undefined ? null : (
        <ImportVideoModal
          file={packageFile}
          package
          onRun={async (onStep) => {
            const outcome = await onImportPackage(packageFile, onStep);
            if (outcome.ok) onStatus(copy.packageImported);
            return outcome;
          }}
          onClose={() => {
            setPackageFile(undefined);
          }}
        />
      )}
    </div>
  );
}
