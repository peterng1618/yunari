import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import ffmpegHashes from "../../../../../../ffmpeg-static-hashes.json";
import { verifyFfmpeg } from "../themes/ffmpeg-hash.mjs";
import type { PanelGeometry } from "./panel-device.js";

/**
 * The TUR panel's own H.264 decoder, fed one elementary stream.
 *
 * **This is a device transform, not a general video pipeline.** The panel
 * decodes the stream itself, so the host sends compressed bytes and no frames:
 * that is what makes a video theme play at 30 fps instead of at the host's
 * capture cadence.
 *
 * **The encoder's flags are L-Connect's own.** `ThemeController.TransferH264`
 * runs its bundled ffmpeg with `-vcodec libx264 -x264opts bframes=0 -threads 4
 * -preset ultrafast`, and every frame rate and bitrate choice of this host's
 * own was absent. A stream with B-frames leaves the panel's decoder waiting for
 * frames it has not received, so `bframes=0` is a compatibility requirement,
 * not a speed knob.
 *
 * The one addition is the fit: the wire frame is the panel's portrait geometry
 * (464×1920 for the 9.2"), the glass is a landscape strip, and a picture is
 * upright when the frame holds the landscape composition turned **90°
 * clockwise** (`transpose=1`). Measured on the attached panel.
 */

/** The vendor driver's default block size (`WinUsb.CheckH264Block`), used only
 *  when the panel answers the block-size query with zero or not at all. */
export const H264_BLOCK_BYTES = 202_752;

const FFMPEG_STATIC_VERSION: string = createRequire(import.meta.url)(
  "ffmpeg-static/package.json",
).version;

/** ffmpeg's progress goes to stderr; a runaway log must not fill the buffer. */
const MAX_STDERR_BYTES = 4 * 1024 * 1024;

export type Run = (
  args: readonly string[],
) => Promise<{ readonly code: number; readonly stderr: string }>;

export interface EncodeOptions {
  readonly ffmpegPath?: string;
  /** The theme's authored pan; centred cover when absent. */
  readonly placement?: {
    readonly offsetX: number;
    readonly offsetY: number;
  };
  /** Test seam for the spawn; production uses `encoderRun`. */
  readonly run?: Run;
  readonly verifyForTest?: typeof verifyFfmpeg;
}

export function panelH264Args(
  input: string,
  output: string,
  geometry: PanelGeometry,
  placement: { readonly offsetX: number; readonly offsetY: number } = {
    offsetX: 0,
    offsetY: 0,
  },
): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-i",
    input,
    "-an",
    // Formatting the panel's own picture: cover the glass, pan the way the
    // theme authored it, then turn onto the wire's portrait frame.
    "-vf",
    panelFilter(geometry, placement),
    // The vendor's encode, verbatim. It fixes no frame rate, no bitrate and
    // no keyframe interval: the panel takes the stream's own pacing.
    "-c:v",
    "libx264",
    // The panel's decoder reads 4:2:0 only, and an authored clip may not be.
    "-pix_fmt",
    "yuv420p",
    "-x264opts",
    "bframes=0",
    "-threads",
    "4",
    "-preset",
    "ultrafast",
    "-f",
    "h264",
    output,
  ];
}

/**
 * The composition, fitted to the glass and panned the way the theme authored
 * it, then turned onto the wire's portrait frame.
 *
 * **The pan is `scene-fabric`'s `placement`, in ffmpeg expressions.** The same
 * rule applies here because the device, not the player page, is drawing: cover,
 * then pan within the overhang, and zoom first when the source's own aspect
 * leaves no overhang to pan through. The box is the landscape view
 * (`height × width`), because the turn comes after the crop.
 */
function panelFilter(
  geometry: PanelGeometry,
  placement: { readonly offsetX: number; readonly offsetY: number },
): string {
  const boxWidth = geometry.height;
  const boxHeight = geometry.width;
  const offsetX = Number.isFinite(placement.offsetX) ? placement.offsetX : 0;
  const offsetY = Number.isFinite(placement.offsetY) ? placement.offsetY : 0;

  const floorX = boxWidth * (1 + 2 * Math.abs(offsetX));
  const floorY = boxHeight * (1 + 2 * Math.abs(offsetY));
  // ffmpeg's `max` takes two arguments, so the four-way choice nests.
  const factor = `max(max(${boxWidth}/iw,${boxHeight}/ih),max(${floorX}/iw,${floorY}/ih))`;

  return [
    `scale=w='iw*${factor}':h='ih*${factor}'`,
    `crop=${boxWidth}:${boxHeight}:` +
      `x='clip((in_w-${boxWidth})/2-${boxWidth}*${offsetX},0,in_w-${boxWidth})':` +
      `y='clip((in_h-${boxHeight})/2-${boxHeight}*${offsetY},0,in_h-${boxHeight})'`,
    "transpose=1",
  ].join(",");
}

/** One clip, ready to feed: the elementary stream and how fast it plays. */
export interface PanelClip {
  readonly h264: Uint8Array;
  /** The source's frame rate, or 0 when ffmpeg did not report one. The panel
   *  is told this before playback, the way the vendor's app does. */
  readonly fps: number;
  /** The source's playing time in seconds, or 0 when ffmpeg did not report it.
   *  **The feed is paced by this**: a stream handed to the panel faster than it
   *  plays fills the decoder's ring and then starves the picture, and a full
   *  ring is the freeze the vendor's own drain exists to avoid. */
  readonly seconds: number;
}

/** Throws with a sentence the runner can report; the caller falls back to
 *  still frames rather than showing a black panel. */
export async function encodePanelH264(
  mp4: Uint8Array,
  geometry: PanelGeometry,
  options: EncodeOptions = {},
): Promise<PanelClip> {
  const executable = options.ffmpegPath ?? ffmpegStatic;

  if (executable === null) {
    throw new Error(
      "No ffmpeg encoder is available on this host, so the video cannot be played.",
    );
  }

  // The bytes about to be executed came from an install-time download that
  // npm's tarball integrity does not cover; nothing else checks them.
  const verification = (options.verifyForTest ?? verifyFfmpeg)({
    binaryPath: executable,
    version: FFMPEG_STATIC_VERSION,
    platform: process.platform,
    arch: process.arch,
    hashes: ffmpegHashes,
  });

  if (!verification.ok) {
    throw new Error(verification.message);
  }

  const directory = await mkdtemp(
    path.join(os.tmpdir(), "yunari-panel-video-"),
  );
  try {
    const input = path.join(directory, "in.mp4");
    const output = path.join(directory, "out.h264");
    await writeFile(input, mp4);

    const outcome = await (options.run ?? encoderRun(executable))(
      panelH264Args(input, output, geometry, options.placement),
    );

    if (outcome.code !== 0) {
      throw new Error(
        `The panel video could not be encoded; ffmpeg exited with code ${outcome.code}.`,
      );
    }

    return {
      h264: new Uint8Array(await readFile(output)),
      fps: clipFps(outcome.stderr),
      seconds: clipSeconds(outcome.stderr),
    };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }
}

/** ffmpeg names the first input stream's rate before it encodes a frame. */
const FPS = /(\d+(?:\.\d+)?)\s+fps/;

/** ffmpeg reports the input's length once, before it encodes anything. */
const DURATION = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/;

/**
 * The clip's playing time, from ffmpeg's input report.
 *
 * A stream whose length is unknown is fed at the vendor's fixed pause instead;
 * the driver's depth gate is then the only ceiling, which is what the panel
 * had before the feed was paced.
 */
export function clipSeconds(stderr: string): number {
  const match = DURATION.exec(stderr);
  if (match === null) return 0;

  const seconds =
    Number(match[1] ?? 0) * 3600 +
    Number(match[2] ?? 0) * 60 +
    Number(match[3] ?? 0);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

export function clipFps(stderr: string): number {
  const match = FPS.exec(stderr);
  if (match?.[1] === undefined) return 0;

  const fps = Math.round(Number(match[1]));
  // The vendor app sends the clip's own rate and only when it is usable.
  return fps > 0 && fps <= 60 ? fps : 0;
}

function encoderRun(executable: string): Run {
  return (args) =>
    new Promise((resolve) => {
      execFile(
        executable,
        [...args],
        { windowsHide: true, maxBuffer: MAX_STDERR_BYTES },
        (error, _stdout, stderr) => {
          if (error === null) {
            resolve({
              code: 0,
              stderr: typeof stderr === "string" ? stderr : "",
            });
            return;
          }

          const code = (error as { code?: unknown }).code;
          resolve({
            code: typeof code === "number" ? code : 1,
            stderr: typeof stderr === "string" ? stderr : "",
          });
        },
      );
    });
}
