import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { readVideoFacts } from "@yunari/theme-package";
import ffmpegStatic from "ffmpeg-static";
import ffmpegHashes from "../../../../../../ffmpeg-static-hashes.json";
import { verifyFfmpeg } from "../themes/ffmpeg-hash.mjs";
import type { PanelGeometry, PanelVideoPlacement } from "./panel-device.js";
import {
  panelFilter,
  type VideoSourceFacts,
} from "./panel-video-composition.js";
import {
  type PanelVideoRotation,
  type PanelVideoTurn,
  rotationBox,
  turnRefusal,
  videoRotation,
} from "./panel-video-turn.js";

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
 * (464×1920 for the 9.2"), the glass is a landscape strip, and how the picture
 * reaches the wire frame is the display record's mounting angle, applied by
 * `panel-video-turn.ts`. The attached 9.2" is upright with a **90°** record
 * (`transpose=1`), measured on hardware.
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
  /** The theme's authored pan and zoom, plus the advanced background's
   *  composition and fill when it has one. */
  readonly placement?: PanelVideoPlacement;
  /** Whole degrees clockwise the display turns the composition. */
  readonly rotation?: number;
  /** Test seam for the spawn; production uses `encoderRun`. */
  readonly run?: Run;
  readonly verifyForTest?: typeof verifyFfmpeg;
}

export function panelH264Args(
  input: string,
  output: string,
  geometry: PanelGeometry,
  placement: PanelVideoPlacement = {
    offsetX: 0,
    offsetY: 0,
  },
  turnOrAngle: PanelVideoTurn | PanelVideoRotation = "none",
  source?: VideoSourceFacts,
): string[] {
  const rotation: PanelVideoRotation =
    typeof turnOrAngle === "string"
      ? { kind: "turn", turn: turnOrAngle }
      : turnOrAngle;
  const filter = panelFilter(
    rotationBox(geometry, rotation),
    placement,
    source,
    rotation,
  );

  return [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-i",
    input,
    "-an",
    // Formatting the panel's own picture: cover the glass, pan the way the
    // theme authored it, then turn onto the wire's portrait frame.
    ...(filter.complex
      ? ["-filter_complex", filter.filter, "-map", "[out]"]
      : ["-vf", filter.filter]),
    // The fill source never ends; the source's own length bounds the output.
    ...(filter.durationSeconds === undefined
      ? []
      : ["-t", String(filter.durationSeconds)]),
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

/** One clip, ready to feed: the elementary stream and how long it plays. */
export interface PanelClip {
  readonly h264: Uint8Array;
  /** The clip's length in seconds, or 0 when ffmpeg did not report one. The
   *  feed paces each block to its own share, so the panel is never handed
   *  stream faster than it plays. */
  readonly seconds: number;
}

/** Throws with a sentence the runner can report; the caller falls back to
 *  still frames rather than showing a black panel. */
export async function encodePanelH264(
  mp4: Uint8Array,
  geometry: PanelGeometry,
  options: EncodeOptions = {},
): Promise<PanelClip> {
  const placement = options.placement ?? { offsetX: 0, offsetY: 0 };
  const rotation = videoRotation(
    options.rotation ?? 0,
    placement.shape ?? "rect",
  );
  if (rotation === undefined) {
    throw new Error(turnRefusal(options.rotation ?? 0));
  }

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

    const facts = readVideoFacts(mp4);
    const outcome = await (options.run ?? encoderRun(executable))(
      panelH264Args(
        input,
        output,
        geometry,
        options.placement,
        rotation,
        facts,
      ),
    );

    if (outcome.code !== 0) {
      throw new Error(
        `The panel video could not be encoded; ffmpeg exited with code ${outcome.code}.`,
      );
    }

    return {
      h264: new Uint8Array(await readFile(output)),
      seconds: clipSeconds(outcome.stderr),
    };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }
}

/** ffmpeg prints `Duration: HH:MM:SS.xx` once per input, before encoding. */
const DURATION = /Duration:\s*(\d+):(\d{2}):(\d{2})\.(\d{2})/;

export function clipSeconds(stderr: string): number {
  const match = DURATION.exec(stderr);
  if (match === null) return 0;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]) + Number(`0.${match[4]}`);
  const total = hours * 3600 + minutes * 60 + seconds;
  // A zero or absurd duration is not a length the feed can pace against.
  return Number.isFinite(total) && total > 0 ? total : 0;
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
