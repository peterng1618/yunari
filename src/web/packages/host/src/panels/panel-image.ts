import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import ffmpegHashes from "../../../../../../ffmpeg-static-hashes.json";
import { verifyFfmpeg } from "../themes/ffmpeg-hash.mjs";

/**
 * One decoded still, for a panel that needs pixels rather than a file.
 *
 * The streaming panels send a JPEG straight down the wire and never need this.
 * A panel that composes pixels itself takes something else: the Kraken's
 * streaming frame is **8-bit palette indices**, and its rotation is host-side,
 * so both routes start from a decoded raster.
 *
 * **ffmpeg is reused rather than added.** The host already ships it, already
 * verifies its digest before running it (`ffmpeg-hash.mjs`), and already spawns
 * it for theme video; a second decoder would be a second binary to trust.
 *
 * **A live frame does not go through ffmpeg.** A spawn plus digest check costs
 * 220-250 ms for a 320x320 PNG, and ffmpeg emits nothing before its input's EOF
 * (measured on this build), so a live panel decodes the PNG the rasteriser
 * already produces in process — `png-raster.ts` owns that, and this module's
 * ffmpeg path stays for arbitrary stills.
 */

/** The bundled ffmpeg's own version; the hash file is keyed by it. */
const FFMPEG_STATIC_VERSION: string = createRequire(import.meta.url)(
  "ffmpeg-static/package.json",
).version;

/** ffmpeg's own log goes to stderr; a runaway log must not fill the buffer. */
const MAX_STDERR_BYTES = 4 * 1024 * 1024;

export interface RawFrame {
  readonly width: number;
  readonly height: number;
  /** Straight RGBA, 4 bytes per pixel, row-major, top-left origin. */
  readonly rgba: Uint8Array;
}

export interface DecodeOptions {
  /** Test seam, as `normalize-video.ts` has: a fixture needs no digest. */
  readonly ffmpegPath?: string;
  /** Skips the digest check for a fake executable a case spawns. */
  readonly verifyForTest?: boolean;
}

/**
 * Whether this host may execute the bundled binary.
 *
 * The bytes come from an install-time download npm's tarball integrity does not
 * cover, so the same recorded digest is checked before every spawn — here as in
 * `normalize-video.ts`, through the one verifier both call.
 */
function verified(executable: string, forTest = false): boolean {
  if (forTest) return true;

  return verifyFfmpeg({
    binaryPath: executable,
    version: FFMPEG_STATIC_VERSION,
    platform: process.platform,
    arch: process.arch,
    hashes: ffmpegHashes,
  }).ok;
}

function runFfmpeg(
  executable: string,
  args: readonly string[],
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      executable,
      args,
      { maxBuffer: MAX_STDERR_BYTES, windowsHide: true },
      (error, _stdout, stderr) => {
        const code = error === null ? 0 : errorCode(error);
        resolve({ code, stderr: typeof stderr === "string" ? stderr : "" });
      },
    );
  });
}

/** ffmpeg's exit code, or 1 for a spawn failure that never produced one. */
function errorCode(error: { code?: unknown }): number {
  return typeof error.code === "number" ? error.code : 1;
}

/**
 * One frame of `bytes` (any format ffmpeg reads) as an RGBA raster of exactly
 * `width`x`height`.
 *
 * **Stretched, not letterboxed.** A round panel is filled corner to corner by
 * the composition the same way a square one is, and the caller masks the circle
 * rather than the decoder deciding what to crop.
 */
export async function decodeStill(
  bytes: Uint8Array,
  width: number,
  height: number,
  options: DecodeOptions = {},
): Promise<RawFrame> {
  const executable = options.ffmpegPath ?? ffmpegStatic;

  if (executable === null) {
    throw new Error("No ffmpeg is available on this host to decode an image.");
  }
  if (!verified(executable, options.verifyForTest)) {
    throw new Error(
      "The bundled ffmpeg does not match the hash recorded for this platform, " +
        "so the image was not decoded.",
    );
  }

  const directory = await mkdtemp(path.join(os.tmpdir(), "yunari-decode-"));

  try {
    const input = path.join(directory, "in");
    const output = path.join(directory, "out.rgba");
    await writeFile(input, bytes);

    // `-frames:v 1` is what makes a still a still: an animated GIF decodes to
    // its first frame here. `rawvideo` is the only output that promises an exact
    // byte count, since every container format would re-encode.
    const { code } = await runFfmpeg(executable, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      input,
      "-frames:v",
      "1",
      "-vf",
      `scale=${width}:${height}:flags=lanczos`,
      "-pix_fmt",
      "rgba",
      "-f",
      "rawvideo",
      output,
    ]);

    if (code !== 0) {
      throw new Error(`That image could not be decoded (ffmpeg ${code}).`);
    }

    const rgba = new Uint8Array(await readFile(output));
    const expected = width * height * 4;

    if (rgba.length !== expected) {
      throw new Error(
        `The decoder produced ${rgba.length} bytes; a ${width}x${height} frame is ${expected}.`,
      );
    }

    return { width, height, rgba };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}
