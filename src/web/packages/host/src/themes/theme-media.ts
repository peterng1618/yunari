import fs from "node:fs/promises";
import path from "node:path";
import {
  type AssetReference,
  activeBackgroundComposition,
  artboardSolidColor,
  BACKGROUND_MEDIA_DEFAULTS,
  computeArtboardTransform,
  type FabricThemeEnvelope,
  type Globals,
  isArtboardGradient,
  MAX_BACKGROUND_OFFSET,
  MAX_BACKGROUND_SCALE,
  MIN_BACKGROUND_OFFSET,
  MIN_BACKGROUND_SCALE,
  type PalettePaint,
  resolveBackgroundComposition,
  resolveStyleValue,
} from "@yunari/renderer-core";
import { readVideoFacts } from "@yunari/theme-package";
import type { PanelVideoPlacement } from "../panels/panel-device.js";
import { readContainedFile } from "./contained-read.js";
import { isValidThemeId } from "./store.js";
import {
  extractVideoFrame,
  type FrameExtractOptions,
  type FrameExtractResult,
  type PanelClipTarget,
  type TranscodeResult,
  transcodeVideo,
} from "./video-frame.js";

/**
 * The theme video as a panel needs it: one still frame for an overlay panel, or
 * a clip scaled to a still panel's own pixels.
 *
 * Both are derived, never authored, so they are cached under the host's cache
 * directory and named by their inputs:
 *
 *     <theme-id>~<asset-name>~f<frame>.png
 *     <theme-id>~<asset-name>~<width>x<height>.mp4
 *
 * **The name is the invalidation.** A panel asks for the picture its theme json
 * now describes; if that name is not in the cache, the host generates it
 * before the page can load anything. A save drops the theme's entries when it
 * changed the video or the frame, and the next ask regenerates.
 */

/** A still is a PNG of one frame; the glass blurs it. */
const MAX_STILL_BYTES = 8 * 1024 * 1024;
/** A device-sized clip is disposable host data. */
const MAX_VIDEO_BYTES = 64 * 1024 * 1024;
/**
 * The bake's own revision. The name is the invalidation, so a change to the
 * composed graph that leaves the authored inputs alone still has to move the
 * name; otherwise a host keeps serving the previous picture from its cache.
 */
const PANEL_CLIP_REVISION = 2;
/** Long asset names keep their frame or size suffix; the rest is hashed. */
const MAX_ASSET_LENGTH = 96;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The video a theme draws behind its board, and the frame it declares. Only a
 *  declared `video` asset qualifies: an image is already the picture. */
export interface BackgroundVideo {
  readonly asset: AssetReference;
  readonly frame: number;
}

export function backgroundVideoOf(
  envelope: FabricThemeEnvelope | undefined,
): BackgroundVideo | undefined {
  const media = envelope?.background?.media;
  if (media === undefined) return undefined;
  const asset = (envelope?.assets ?? []).find(
    (candidate) => candidate.id === media.assetId,
  );
  if (asset === undefined || asset.kind !== "video") return undefined;
  return { asset, frame: media.fallbackFrame ?? 0 };
}

/** The still's cache name, or nothing when the theme has no video background. */
export function stillMediaName(
  id: string,
  envelope: FabricThemeEnvelope | undefined,
): string | undefined {
  const video = backgroundVideoOf(envelope);
  return video === undefined
    ? undefined
    : mediaName(id, video, `f${video.frame}.png`);
}

/** The panel-sized clip's cache name. */
export function panelVideoMediaName(
  id: string,
  envelope: FabricThemeEnvelope | undefined,
  width: number,
  height: number,
): string | undefined {
  const video = backgroundVideoOf(envelope);
  if (video === undefined) return undefined;
  const geometry = backgroundGeometryOf(envelope);
  // The authored pan and zoom are part of the picture, so a cache written for
  // another offset or scale is a different clip. `o`/`s` also invalidate the
  // earlier cover-only copies under the same pixel size; `c` is the composition
  // and `v` is the bake graph's revision.
  const placement = panelVideoPlacement(envelope);
  const flips = `${placement.flipX === true ? "x" : ""}${placement.flipY === true ? "y" : ""}`;
  const suffix = `${width}x${height}-o${number(placement.offsetX)}_${number(
    placement.offsetY,
  )}-s${number(geometry.scale)}${compositionKey(placement)}-f${flips}-v${String(
    PANEL_CLIP_REVISION,
  )}.mp4`;
  return mediaName(id, video, suffix);
}

/**
 * The panel video's placement: the authored pan and zoom, plus the composition
 * and its resolved paint when the background is advanced.
 *
 * `fill` is the paint this media fades into — the media's own `color` — wherever
 * the anchored media leaves the box uncovered. A simple background answers the
 * geometry alone, so the bake keeps its plain cover path.
 */
export function panelVideoPlacement(
  envelope: FabricThemeEnvelope | undefined,
): PanelVideoPlacement {
  const geometry = backgroundGeometryOf(envelope);
  const background = envelope?.background;
  const media = background?.media;
  const flips = {
    ...(media?.flipX === true ? { flipX: true } : {}),
    ...(media?.flipY === true ? { flipY: true } : {}),
  };
  const composition = activeBackgroundComposition(background);
  if (composition === undefined) {
    return {
      offsetX: geometry.offsetX,
      offsetY: geometry.offsetY,
      scale: geometry.scale,
      ...flips,
    };
  }

  const fill = paintOf(
    resolveStyleValue(
      media?.color,
      (envelope?.globals ?? {}) as Globals,
      "background",
      [],
    ),
  );

  return {
    offsetX: geometry.offsetX,
    offsetY: geometry.offsetY,
    scale: geometry.scale,
    ...flips,
    composition,
    ...(fill === undefined ? {} : { fill }),
  };
}

/** A resolved style value as a palette paint, or nothing when it is not one. */
function paintOf(value: unknown): PalettePaint | undefined {
  const solid = artboardSolidColor(value);
  if (solid !== undefined) return { kind: "solid", color: solid };
  return isArtboardGradient(value) ? value : undefined;
}

/** The part of a clip name that changes when the composition changes. */
function compositionKey(placement: PanelVideoPlacement): string {
  if (placement.composition === undefined && placement.fill === undefined) {
    return "";
  }
  return `-c${digest(JSON.stringify([placement.composition, placement.fill]))}`;
}

/** The authored geometry the page would have applied itself. */
export interface BackgroundGeometry {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly scale: number;
}

export function backgroundGeometryOf(
  envelope: FabricThemeEnvelope | undefined,
): BackgroundGeometry {
  const media = envelope?.background?.media;
  return {
    offsetX: bounded(
      media?.offsetX,
      BACKGROUND_MEDIA_DEFAULTS.offsetX,
      MIN_BACKGROUND_OFFSET,
      MAX_BACKGROUND_OFFSET,
    ),
    offsetY: bounded(
      media?.offsetY,
      BACKGROUND_MEDIA_DEFAULTS.offsetY,
      MIN_BACKGROUND_OFFSET,
      MAX_BACKGROUND_OFFSET,
    ),
    scale: bounded(
      media?.scale,
      BACKGROUND_MEDIA_DEFAULTS.scale,
      MIN_BACKGROUND_SCALE,
      MAX_BACKGROUND_SCALE,
    ),
  };
}

/**
 * The media layer's box on the panel, in panel pixels.
 *
 * A display-bounded layer is the screen. A theme-bounded one is the artboard's
 * own screen rect, which is smaller than the panel when the theme's ratio
 * differs; baking a viewport-sized crop for it would show the wrong rectangle.
 */
function panelMediaBox(
  envelope: FabricThemeEnvelope,
  viewport: { readonly width: number; readonly height: number },
): { readonly width: number; readonly height: number } {
  const size = {
    width: Math.max(1, Math.floor(viewport.width)),
    height: Math.max(1, Math.floor(viewport.height)),
  };
  if (envelope.background?.media?.bounds === "display") return size;
  try {
    const transform = computeArtboardTransform({
      artboard: {
        width: envelope.artboard.width,
        height: envelope.artboard.height,
      },
      viewport: size,
      contentFit: envelope.artboard.contentFit ?? "contain",
      shape: "rect",
      layoutShape: "rect",
      themeShape: envelope.artboard.shape ?? "rect",
    });
    const width = Math.round(envelope.artboard.width * transform.scale);
    const height = Math.round(envelope.artboard.height * transform.scale);
    return width > 0 && height > 0 ? { width, height } : size;
  } catch {
    return size;
  }
}

function bounded(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

/** A number written the same way every time, as part of a cache name. */
function number(value: number): string {
  return value === 0 ? "0" : String(value);
}

function mediaName(id: string, video: BackgroundVideo, suffix: string): string {
  const base = path
    .basename(video.asset.path)
    .replace(/\.[^.]+$/u, "")
    .replace(/[^A-Za-z0-9._-]/gu, "_");
  // Truncating the whole name would cut the suffix that distinguishes one
  // frame or one panel size from the next, and two long names sharing a prefix
  // would collide. Only the asset part is bounded, and it is hashed when cut.
  const asset =
    base.length <= MAX_ASSET_LENGTH
      ? base
      : `${base.slice(0, MAX_ASSET_LENGTH - 9)}-${digest(base)}`;
  return `${safe(id)}~${asset}~${suffix}`;
}

function digest(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function safe(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/gu, "_");
}

export interface ThemeMediaSource {
  readAsset(
    id: string,
    assetPath: string,
  ): Promise<{ readonly bytes: Uint8Array } | undefined>;
}

export interface ThemeMediaOptions {
  readonly directory: string;
  readonly readAsset: ThemeMediaSource["readAsset"];
  /** Injected so tests drive generation without an encoder. */
  readonly extract?: (
    bytes: Uint8Array,
    frame: number,
    options?: FrameExtractOptions,
  ) => Promise<FrameExtractResult>;
  readonly transcode?: (
    bytes: Uint8Array,
    target: PanelClipTarget,
    options?: FrameExtractOptions,
  ) => Promise<TranscodeResult>;
  readonly onError?: (message: string) => void;
}

export interface ThemeMedia {
  /** The still the theme json describes, generated when the name is missing. */
  still(
    id: string,
    envelope: FabricThemeEnvelope,
  ): Promise<{ readonly name: string; readonly bytes: Uint8Array } | undefined>;
  /** The clip scaled to `size`, generated when the name is missing. */
  panelVideo(
    id: string,
    envelope: FabricThemeEnvelope,
    size: { readonly width: number; readonly height: number },
  ): Promise<{ readonly name: string; readonly bytes: Uint8Array } | undefined>;
  /** Drops every entry for a theme; a save that changed an input calls this. */
  forget(id: string): Promise<void>;
}

export function createThemeMedia(options: ThemeMediaOptions): ThemeMedia {
  const extract = options.extract ?? extractVideoFrame;
  const transcode = options.transcode ?? transcodeVideo;
  const report =
    options.onError ??
    ((message: string) => console.error(`Theme media: ${message}`));
  /** One generation per name: simultaneous panel asks share it. */
  const generating = new Map<string, Promise<Uint8Array | undefined>>();

  const filePath = (name: string): string => path.join(options.directory, name);

  const read = async (
    name: string,
    maxBytes: number,
  ): Promise<Uint8Array | undefined> => {
    const bytes = await readContainedFile(options.directory, name, maxBytes);
    if (bytes === undefined) return undefined;
    return name.endsWith(".png") && !isPng(bytes)
      ? undefined
      : new Uint8Array(bytes);
  };

  const write = async (name: string, bytes: Uint8Array): Promise<void> => {
    await fs.mkdir(options.directory, { recursive: true });
    // Staged and renamed: a request racing a save sees the old entry or the new
    // one, never half of either.
    const staging = path.join(
      options.directory,
      `.${Date.now()}.${Math.random().toString(36).slice(2)}`,
    );
    try {
      await fs.writeFile(staging, bytes);
      await fs.rename(staging, filePath(name));
    } catch (error) {
      await fs.rm(staging, { force: true });
      throw error;
    }
  };

  const once = (
    name: string,
    work: () => Promise<Uint8Array | undefined>,
  ): Promise<Uint8Array | undefined> => {
    const pending = generating.get(name);
    if (pending !== undefined) return pending;
    const started = work().finally(() => {
      if (generating.get(name) === started) generating.delete(name);
    });
    generating.set(name, started);
    return started;
  };

  const cached = async (
    name: string | undefined,
    maxBytes: number,
    make: () => Promise<Uint8Array | undefined>,
  ): Promise<
    { readonly name: string; readonly bytes: Uint8Array } | undefined
  > => {
    if (name === undefined) return undefined;
    const found = await read(name, maxBytes);
    const bytes = found ?? (await once(name, make));
    return bytes === undefined ? undefined : { name, bytes };
  };

  const videoBytes = async (
    id: string,
    video: BackgroundVideo,
  ): Promise<Uint8Array | undefined> => {
    const found = await options
      .readAsset(id, video.asset.path)
      .catch((error) => {
        report(messageOf(error));
        return undefined;
      });
    if (found !== undefined) return found.bytes;
    report(`Background video "${video.asset.path}" has no readable bytes.`);
    return undefined;
  };

  return {
    still(id, envelope) {
      const name = stillMediaName(id, envelope);
      return cached(name, MAX_STILL_BYTES, async () => {
        const video = backgroundVideoOf(envelope);
        if (name === undefined || video === undefined) return undefined;
        const bytes = await videoBytes(id, video);
        if (bytes === undefined) return undefined;
        const frame = await extract(bytes, video.frame, undefined);
        if (!frame.ok) {
          report(frame.message);
          return undefined;
        }
        try {
          await write(name, frame.bytes);
          return frame.bytes;
        } catch (error) {
          report(messageOf(error));
          return undefined;
        }
      });
    },

    async panelVideo(id, envelope, viewport) {
      // The page composes the media, fill and fade itself, and lays this clip
      // down inside the media's box as-is: encoding the whole layer here would
      // make the page cover-fit the clip a second time and crop the source
      // twice. A centred band fits the picture's long edge, so the source's
      // own size decides the box before the clip is encoded.
      const video = backgroundVideoOf(envelope);
      if (video === undefined) return undefined;
      const bytes = await videoBytes(id, video);
      if (bytes === undefined) return undefined;
      const box = panelMediaBox(envelope, viewport);
      const composition = resolveBackgroundComposition(
        box,
        activeBackgroundComposition(envelope.background),
        readVideoFacts(bytes),
      );
      const size = {
        width: Math.max(1, Math.round(composition.region.width)),
        height: Math.max(1, Math.round(composition.region.height)),
      };
      const geometry = backgroundGeometryOf(envelope);
      const name = panelVideoMediaName(id, envelope, size.width, size.height);
      if (name === undefined) return undefined;
      return cached(name, MAX_VIDEO_BYTES, async () => {
        const scaled = await transcode(
          bytes,
          { ...size, ...geometry },
          undefined,
        );
        if (!scaled.ok) {
          report(scaled.message);
          return undefined;
        }
        try {
          await write(name, scaled.bytes);
          return scaled.bytes;
        } catch (error) {
          report(messageOf(error));
          return undefined;
        }
      });
    },

    async forget(id) {
      if (!isValidThemeId(id)) return;
      let names: string[];
      try {
        names = await fs.readdir(options.directory);
      } catch {
        return;
      }
      await Promise.all(
        names
          .filter((name) => name.startsWith(`${safe(id)}~`))
          .map((name) =>
            fs
              .rm(path.join(options.directory, name), { force: true })
              .catch((error) => report(messageOf(error))),
          ),
      );
    },
  };
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength > PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
