import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

/** A device-sized copy is disposable host data; anything larger is not a
 *  panel's background. */
const MAX_TRANSCODE_BYTES = 64 * 1024 * 1024;

/**
 * The clip scaled to fit a panel, or the sentence naming why it could not be.
 *
 * A still panel renders the theme live, so it does show the picture — but a
 * 3840-wide source decoded in the shared renderer starves every other panel.
 * The copy fits the panel's own box, keeps the source aspect (the page still
 * covers and pans it), drops audio and stays silent and progressive.
 */
export async function transcodeVideo(
  bytes: Uint8Array,
  target: { readonly width: number; readonly height: number },
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

  const box = fitBox(facts.width, facts.height, target.width, target.height);
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
      `scale=${box.width}:${box.height}:force_original_aspect_ratio=decrease`,
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

/** The even box that fits the source inside the target, never upscaled. */
function fitBox(
  width: number,
  height: number,
  targetWidth: number,
  targetHeight: number,
): { readonly width: number; readonly height: number } {
  const factor = Math.min(1, targetWidth / width, targetHeight / height);
  const even = (value: number): number =>
    Math.max(2, Math.floor((value * factor) / 2) * 2);
  return { width: even(width), height: even(height) };
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
