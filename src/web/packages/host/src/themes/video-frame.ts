import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  BACKGROUND_MEDIA_DEFAULTS,
  MAX_BACKGROUND_OFFSET,
  MAX_BACKGROUND_SCALE,
  MIN_BACKGROUND_OFFSET,
  MIN_BACKGROUND_SCALE,
} from "@yunari/renderer-core";
import { readVideoFacts, type VideoFacts } from "@yunari/theme-package";
import { bundledFfmpeg, type Run, type Verify } from "./normalize-video.js";

/**
 * One frame of a theme video, as a PNG a page can stand on.
 *
 * A video panel's page never shows the clip — the device plays it — but its
 * glass still has to sample one picture. The page loading a 4K source for that
 * picture starved the shared renderer (2026-11-02), so the frame is taken here,
 * once, out of process.
 */

/** The long edge a still is drawn at. The glass blurs it and a panel shows a
 *  few hundred pixels wide, so a full-resolution frame is decode memory spent
 *  on a source no sampler resolves. */
const FRAME_MAX_EDGE = 1280;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface FrameExtractOptions {
  readonly maxEdge?: number;
  readonly ffmpegPath?: string;
  readonly run?: Run;
  readonly verifyForTest?: Verify;
}

export type FrameExtractResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly message: string };

/**
 * The declared frame drawn to a PNG, or the sentence naming why it could not be.
 *
 * The frame is addressed by its index because that is how the author declares
 * it (`fallbackFrame`). A constant frame rate is part of the video envelope, so
 * `index / frameRate` is its time; an index past the end is clamped to the last
 * frame rather than refused, because a video re-trimmed after the frame was
 * declared is still a picture the panel can show.
 */
export async function extractVideoFrame(
  bytes: Uint8Array,
  frame: number,
  options: FrameExtractOptions = {},
): Promise<FrameExtractResult> {
  if (!Number.isInteger(frame) || frame < 0)
    return { ok: false, message: "The poster frame is not a whole index." };

  const facts = readVideoFacts(bytes);
  if (facts === undefined || !(facts.frameRate > 0))
    return {
      ok: false,
      message:
        "That video's frame rate cannot be read, so no poster frame can be taken.",
    };

  const encoder = bundledFfmpeg(options);
  if (!encoder.ok) return encoder;

  const at = frameSeconds(facts, frame);
  const box = frameBox(facts.width, facts.height, options.maxEdge);

  // A directory per run under the OS temp root, like the normalizer: two
  // extractions at once cannot overwrite each other, and nothing is left.
  const directory = await mkdtemp(path.join(os.tmpdir(), "yunari-frame-"));
  try {
    const input = path.join(directory, "in.mp4");
    const output = path.join(directory, "out.png");
    await writeFile(input, bytes);
    const outcome = await encoder.run([
      "-hide_banner",
      "-nostdin",
      "-y",
      // Before `-i`: an input seek decodes from the preceding keyframe, which
      // is what keeps a frame late in a long clip from decoding all of it.
      "-ss",
      seconds(at),
      "-i",
      input,
      "-frames:v",
      "1",
      "-vf",
      `scale=${box.width}:${box.height}:force_original_aspect_ratio=decrease`,
      "-f",
      "image2",
      "-update",
      "1",
      output,
    ]);
    if (outcome.code !== 0)
      return {
        ok: false,
        message: `The poster frame could not be extracted; ffmpeg exited with code ${outcome.code}.`,
      };
    const picture = new Uint8Array(await readFile(output));
    if (!isPng(picture))
      return {
        ok: false,
        message:
          "The poster frame could not be extracted; the encoder wrote no picture.",
      };
    return { ok: true, bytes: picture };
  } catch {
    return {
      ok: false,
      message: "The poster frame could not be extracted.",
    };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }
}

export type TranscodeResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly message: string };

/** The panel box and the authored pan and zoom the page would otherwise apply. */
export interface PanelClipTarget {
  readonly width: number;
  readonly height: number;
  readonly offsetX?: number;
  readonly offsetY?: number;
  readonly scale?: number;
}

/** A device-sized copy is disposable host data; anything larger is not a
 *  panel's background. */
const MAX_TRANSCODE_BYTES = 64 * 1024 * 1024;

/**
 * The clip painted into a panel's media box, or the sentence naming why it
 * could not be.
 *
 * A still panel renders the theme live, so it does show the picture — but a
 * 3840-wide source decoded in the shared renderer starves every other panel.
 * The copy is the exact source rect the page's cover fit, pan and zoom would
 * show, scaled to the box: the page then displays it 1:1. Encoding only the
 * cover and leaving the authored zoom for the browser made a zoomed theme
 * decode several times the panel's pixels (Kraken 320x320, 2026-11-02). It
 * drops audio and stays silent and progressive.
 */
export async function transcodeVideo(
  bytes: Uint8Array,
  target: PanelClipTarget,
  options: FrameExtractOptions = {},
): Promise<TranscodeResult> {
  if (
    !Number.isInteger(target.width) ||
    !Number.isInteger(target.height) ||
    target.width <= 0 ||
    target.height <= 0
  )
    return { ok: false, message: "The panel's pixel size is not a size." };

  const facts = readVideoFacts(bytes);
  if (facts === undefined)
    return { ok: false, message: "That video cannot be read." };

  const encoder = bundledFfmpeg(options);
  if (!encoder.ok) return encoder;

  const box = cropPlan(facts.width, facts.height, target);
  const directory = await mkdtemp(path.join(os.tmpdir(), "yunari-transcode-"));
  try {
    const input = path.join(directory, "in.mp4");
    const output = path.join(directory, "out.mp4");
    await writeFile(input, bytes);
    const outcome = await encoder.run([
      "-hide_banner",
      "-nostdin",
      "-y",
      "-i",
      input,
      "-an",
      "-vf",
      `crop=${box.width}:${box.height}:${box.x}:${box.y},scale=${box.outputWidth}:${box.outputHeight}:flags=lanczos`,
      "-c:v",
      "libx264",
      "-profile:v",
      "high",
      "-pix_fmt",
      "yuv420p",
      "-crf",
      "23",
      "-preset",
      "veryfast",
      "-movflags",
      "+faststart",
      "-f",
      "mp4",
      output,
    ]);
    if (outcome.code !== 0)
      return {
        ok: false,
        message: `The panel's copy could not be encoded; ffmpeg exited with code ${outcome.code}.`,
      };
    const encoded = new Uint8Array(await readFile(output));
    if (encoded.byteLength > MAX_TRANSCODE_BYTES || !isMp4(encoded))
      return {
        ok: false,
        message: "The panel's copy could not be encoded.",
      };
    return { ok: true, bytes: encoded };
  } catch {
    return { ok: false, message: "The panel's copy could not be encoded." };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }
}

interface CropPlan {
  /** The source window, in source pixels. */
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
  /** The encoded size: the box, never upscaled past the source window. */
  readonly outputWidth: number;
  readonly outputHeight: number;
}

/**
 * The source rect the page's placement would show, and the size to encode it.
 *
 * This repeats `placement`'s geometry because it is the same picture: cover the
 * box, then pan by the authored offset and zoom by the authored scale. The
 * page displays the result with no geometry of its own, so one encoded pixel is
 * one panel pixel and the browser never magnifies a pre-zoom copy.
 */
function cropPlan(
  sourceWidth: number,
  sourceHeight: number,
  target: PanelClipTarget,
): CropPlan {
  const offsetX = bounded(
    target.offsetX,
    BACKGROUND_MEDIA_DEFAULTS.offsetX,
    MIN_BACKGROUND_OFFSET,
    MAX_BACKGROUND_OFFSET,
  );
  const offsetY = bounded(
    target.offsetY,
    BACKGROUND_MEDIA_DEFAULTS.offsetY,
    MIN_BACKGROUND_OFFSET,
    MAX_BACKGROUND_OFFSET,
  );
  const zoom = bounded(
    target.scale,
    BACKGROUND_MEDIA_DEFAULTS.scale,
    MIN_BACKGROUND_SCALE,
    MAX_BACKGROUND_SCALE,
  );
  const factor =
    Math.max(
      target.width / sourceWidth,
      target.height / sourceHeight,
      (target.width * (1 + 2 * Math.abs(offsetX))) / sourceWidth,
      (target.height * (1 + 2 * Math.abs(offsetY))) / sourceHeight,
    ) * zoom;
  const placedWidth = sourceWidth * factor;
  const placedHeight = sourceHeight * factor;
  const panX = clamp(target.width * offsetX, (placedWidth - target.width) / 2);
  const panY = clamp(
    target.height * offsetY,
    (placedHeight - target.height) / 2,
  );
  // The source window behind the box, panned the same distance as the DOM rect.
  const windowWidth = Math.min(sourceWidth, target.width / factor);
  const windowHeight = Math.min(sourceHeight, target.height / factor);
  const width = evenFloor(windowWidth);
  const height = evenFloor(windowHeight);
  const x = evenWithin(
    (sourceWidth - windowWidth) / 2 - panX / factor,
    sourceWidth - width,
  );
  const y = evenWithin(
    (sourceHeight - windowHeight) / 2 - panY / factor,
    sourceHeight - height,
  );
  // A panel larger than the source window is left for the page to magnify, as
  // it would have before this route existed; encoding an upscale adds no pixels.
  const fit = Math.min(1, width / target.width, height / target.height);
  return {
    width,
    height,
    x,
    y,
    outputWidth: evenFloor(target.width * fit),
    outputHeight: evenFloor(target.height * fit),
  };
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

/** A pan stopped at the placed rect's own edge. */
function clamp(value: number, limit: number): number {
  const bound = Math.max(0, limit);
  return Math.max(-bound, Math.min(bound, value));
}

/** The largest even integer at or below the value, and never zero. */
function evenFloor(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2);
}

/** Rounded to an even offset inside `[0, limit]`, as 4:2:0 needs. */
function evenWithin(value: number, limit: number): number {
  const boundedValue = Math.max(0, Math.min(limit, Math.round(value)));
  return boundedValue - (boundedValue % 2);
}

/** An ISO base media file names its brand in `ftyp` at offset 4. */
function isMp4(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength > 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  );
}

/** The clamped frame's time in seconds. */ function frameSeconds(
  facts: VideoFacts,
  frame: number,
): number {
  const last = Math.max(
    0,
    Math.round((facts.durationMs / 1000) * facts.frameRate) - 1,
  );
  return Math.min(frame, last) / facts.frameRate;
}

/** The even box the still lands in, never upscaled. */
function frameBox(
  width: number,
  height: number,
  maxEdge: number | undefined,
): { readonly width: number; readonly height: number } {
  const edge = maxEdge ?? FRAME_MAX_EDGE;
  const factor =
    Math.max(width, height) > edge ? edge / Math.max(width, height) : 1;
  const even = (value: number): number =>
    Math.max(2, Math.floor((value * factor) / 2) * 2);
  return { width: even(width), height: even(height) };
}

/** A filter time in seconds, without trailing zeros. */
function seconds(value: number): string {
  return value.toFixed(6).replace(/\.?0+$/u, "");
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength > PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
  );
}
