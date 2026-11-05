import {
  MAX_CREDITS_ENTRIES,
  type ThemeCreditsEntry,
  type VideoTrimRange,
} from "@yunari/theme-package";
import type { ImportOutcome } from "./asset-finder/actions.js";
import type {
  AssetImportMetadata,
  AssetManager,
} from "./asset-manager/index.js";
import type { EditorDocument } from "./editor-document.js";
import type { VideoImportStep } from "./panes/assets/import-video-modal.js";
import { uiCopy } from "./ui-copy.js";
import { requestNormalizedVideo } from "./video-normalizer.js";
import {
  creditsEntryOf,
  fetchAuthorName,
  fetchItemAsset,
  mp4NameOf,
  prepareMobilePackage,
  type WallpaperEngineItem,
} from "./wallpaper-engine/client.js";

/** The document and manager a video import writes through, plus the one signal
 *  that says a declaration moved. */
export interface VideoImportHost {
  readonly assets: AssetManager;
  readonly document: EditorDocument;
  readonly declarationsChanged: () => void;
}

/**
 * One Wallpaper Engine video's import: the host's payload bytes, through the
 * normalizer, then the shared declaration. A scene is converted, not imported;
 * `library.ts` never classifies an image or a web wallpaper, so a video is the
 * only item this can receive.
 */
export async function importWallpaperItem(
  host: VideoImportHost,
  item: WallpaperEngineItem,
  trim?: VideoTrimRange,
): Promise<ImportOutcome> {
  const file = await fetchItemAsset(item);
  if (file === undefined) {
    return {
      ok: false,
      message: uiCopy.assets.bytesUnavailable(item.title),
    };
  }

  // §15: a video crosses the host's envelope before the manager sees it, and
  // the normalizer's refusal — never a sentence composed here — is the
  // authority.
  const normalized = await normalizeWallpaperVideo(file, trim);
  if (!normalized.ok) return { ok: false, message: normalized.message };

  const attribution = item.attribution;
  const steamId = attribution?.steamId;
  // The persona name is the import's only outbound lookup. It runs only when
  // the item names an author, and its failure is absence, never a failed
  // import.
  const authorName =
    steamId === undefined ? undefined : await fetchAuthorName(steamId);
  const sourceUrl =
    attribution?.workshopUrl ??
    (steamId === undefined
      ? undefined
      : `https://steamcommunity.com/profiles/${encodeURIComponent(steamId)}`);

  return declareVideo(host, normalized.file, {
    credit: {
      ...creditsEntryOf(item, authorName),
      changes: normalized.reencoded
        ? "Re-encoded to the publish envelope"
        : "Copied unchanged",
    },
    metadata: {
      license: { name: "unknown" },
      ...(sourceUrl === undefined ? {} : { sourceUrl }),
    },
  });
}

/**
 * One picked `.mpkg` or video: the host prepares the bytes, then the same
 * declaration every video import makes.
 *
 * A package is extracted and normalized in the host's single call, so no
 * second normalize request is made; its title is the credit's. A video file
 * is normalized alone and carries no attribution — the file has none.
 */
export interface PickedVideoOptions {
  readonly package: boolean;
  readonly onStep?: (step: VideoImportStep) => void;
  /** A span the video import keeps; packages are extracted, not trimmed. */
  readonly trim?: VideoTrimRange;
}

export async function importPickedVideo(
  host: VideoImportHost,
  file: File,
  options: PickedVideoOptions,
): Promise<ImportOutcome> {
  options.onStep?.("preparing");
  let prepared: File;
  let credit: ThemeCreditsEntry | undefined;
  let metadata: AssetImportMetadata | undefined;

  if (options.package) {
    const answer = await prepareMobilePackage(file);
    if (!answer.ok) return { ok: false, message: answer.message };
    prepared = answer.file;
    credit = {
      kind: "wallpaper",
      title: answer.title ?? mp4NameOf(file.name),
      license: "unknown",
      changes: answer.reencoded
        ? "Re-encoded to the publish envelope"
        : "Copied unchanged",
    };
    // A package carries no workshop id and no author, so its declaration
    // records the licence it cannot know and no source.
    metadata = { license: { name: "unknown" } };
  } else {
    const normalized = await requestNormalizedVideo(file, options.trim);
    if (!normalized.ok) return { ok: false, message: normalized.message };
    prepared = new File(
      [normalized.bytes as unknown as BlobPart],
      mp4NameOf(file.name),
      { type: "video/mp4" },
    );
  }

  options.onStep?.("importing");
  const outcome = await declareVideo(host, prepared, {
    ...(credit === undefined ? {} : { credit }),
    ...(metadata === undefined ? {} : { metadata }),
  });
  return outcome.ok ? { ok: true } : outcome;
}

/**
 * The one video transaction: the manager's caps and reference model, the
 * credit when the import has one, and the background consequence every video
 * import makes. The credit is written first, the same order `importAsset`
 * uses — an import that places nothing still carries its attribution.
 */
async function declareVideo(
  host: VideoImportHost,
  file: File,
  options: {
    readonly credit?: ThemeCreditsEntry;
    readonly metadata?: AssetImportMetadata;
  },
): Promise<ImportOutcome> {
  const credit = options.credit;
  // A fresh declaration always needs a free slot: the credit gains the
  // declaration's own id below, so a legacy credit sharing its title must not
  // mask a full list.
  if (
    credit !== undefined &&
    host.document.credits().length >= MAX_CREDITS_ENTRIES
  ) {
    return { ok: false, message: uiCopy.assets.creditsFull };
  }

  try {
    const reference = await host.assets.import(file, options.metadata);
    if (credit !== undefined)
      host.document.addCredit({ ...credit, assetId: reference.id });
    host.document.setBackgroundAsset(reference.id);
    host.declarationsChanged();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** One video item, through the host's envelope. */
async function normalizeWallpaperVideo(
  file: File,
  trim: VideoTrimRange | undefined,
): Promise<
  | { readonly ok: true; readonly file: File; readonly reencoded: boolean }
  | { readonly ok: false; readonly message: string }
> {
  const normalized = await requestNormalizedVideo(
    new Uint8Array(await file.arrayBuffer()),
    trim,
  );
  if (!normalized.ok) return normalized;
  return {
    ok: true,
    file: new File(
      [normalized.bytes as unknown as BlobPart],
      mp4NameOf(file.name),
      { type: "video/mp4" },
    ),
    reencoded: normalized.reencoded,
  };
}
