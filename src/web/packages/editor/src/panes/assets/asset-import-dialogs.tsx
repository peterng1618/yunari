import type { VideoTrimRange } from "@yunari/theme-package";
import type * as React from "react";
import type { ImportOutcome } from "../../asset-finder/actions.js";
import {
  assetFileName,
  type LocalAssetReference,
} from "../../asset-manager/index.js";
import {
  ImportVideoModal,
  type VideoImportStep,
} from "./import-video-modal.js";
import { PlaceImageModal } from "./place-image-modal.js";
import { VideoTrimModal } from "./video-trim-modal.js";

/** A just-declared picture waiting for its destination. */
export interface AssetPlacement {
  readonly file: File;
  readonly asset: LocalAssetReference;
  readonly previewUrl: string | undefined;
}

/** A picked video's trim surface, before its import modal. */
export interface AssetVideoTrim {
  readonly file: File;
  readonly src: string;
}

/** The pick an import modal is running: a video or package the host prepares
 *  before anything is declared. */
export interface AssetVideoImport {
  readonly file: File;
  readonly package: boolean;
  readonly trim?: VideoTrimRange;
}

/**
 * The three dialogs a pick can open: place a picture, trim a video, then run
 * the host's import. They are one component because they are one flow — each
 * hands the next its result — and the pane draws them all in the same place.
 */
export function AssetImportDialogs({
  placement,
  videoTrim,
  videoImport,
  onPlace,
  onBackground,
  onPlacementClose,
  onVideoTrimConfirm,
  onVideoTrimClose,
  onVideoRun,
  onVideoImportClose,
}: {
  readonly placement: AssetPlacement | undefined;
  readonly videoTrim: AssetVideoTrim | undefined;
  readonly videoImport: AssetVideoImport | undefined;
  readonly onPlace: (placement: AssetPlacement) => void;
  readonly onBackground: ((placement: AssetPlacement) => void) | undefined;
  readonly onPlacementClose: () => void;
  readonly onVideoTrimConfirm: (
    trim: VideoTrimRange | undefined,
    file: File,
  ) => void;
  readonly onVideoTrimClose: () => void;
  readonly onVideoRun: (
    pick: AssetVideoImport,
    onStep: (step: VideoImportStep) => void,
  ) => Promise<ImportOutcome>;
  readonly onVideoImportClose: () => void;
}): React.JSX.Element {
  return (
    <>
      {placement === undefined ? null : (
        <PlaceImageModal
          name={assetFileName(placement.asset)}
          {...(placement.previewUrl === undefined
            ? {}
            : { previewUrl: placement.previewUrl })}
          onPlace={() => onPlace(placement)}
          onBackground={
            onBackground === undefined
              ? undefined
              : () => onBackground(placement)
          }
          onClose={onPlacementClose}
        />
      )}
      {videoTrim === undefined ? null : (
        <VideoTrimModal
          src={videoTrim.src}
          name={videoTrim.file.name}
          onConfirm={(trim) => onVideoTrimConfirm(trim, videoTrim.file)}
          onClose={onVideoTrimClose}
        />
      )}
      {videoImport === undefined ? null : (
        <ImportVideoModal
          file={videoImport.file}
          package={videoImport.package}
          onRun={(onStep) => onVideoRun(videoImport, onStep)}
          onClose={onVideoImportClose}
        />
      )}
    </>
  );
}
