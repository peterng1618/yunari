import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import ffmpegHashes from "../../../../../../ffmpeg-static-hashes.json";
import { verifyFfmpeg } from "../themes/ffmpeg-hash.mjs";
import type { PanelVideoPlacement } from "./panel-device.js";

/**
 * The clip the 5" panel decodes itself: 800×480 H.264 in an MP4, no audio.
 *
 * **The bundled ffmpeg is reused, not replaced.** The host already ships it,
 * already verifies its digest before running it, and already spawns it for
 * theme video; a second encoder would be a second binary to trust.
 */

/** ffmpeg's own version; the hash file is keyed by it. */
const FFMPEG_STATIC_VERSION: string = createRequire(import.meta.url)(
  "ffmpeg-static/package.json",
).version;

/** ffmpeg's log goes to stderr; a runaway log must not fill the buffer. */
const MAX_STDERR_BYTES = 4 * 1024 * 1024;

// ponytail: the cache lives under the temp dir, so a reboot re-encodes the
// clip. Move it under the host's data directory when a start has to survive
// temp cleanup.
const CACHE_DIRECTORY = path.join(os.tmpdir(), "yunari-panel-video");

export type TranscodeResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly message: string };

type Run = (
  args: readonly string[],
) => Promise<{ code: number; stderr: string }>;

export async function transcodeForPanel(
  bytes: Uint8Array,
  options: {
    readonly ffmpegPath?: string;
    readonly run?: Run;
    readonly verifyForTest?: boolean;
    /** The theme's authored pan; centred cover when absent. */
    readonly placement?: PanelVideoPlacement;
  } = {},
): Promise<TranscodeResult> {
  const placement = options.placement ?? { offsetX: 0, offsetY: 0 };
  const cachePath = cached(sha256(bytes, placement));

  // The pan changes the pixels, so it is part of the key: the same source
  // authored at a different offset is a different clip.
  const cachedBytes = await readFile(cachePath).catch(() => undefined);
  if (cachedBytes !== undefined) {
    return { ok: true, bytes: new Uint8Array(cachedBytes) };
  }

  const executable = options.ffmpegPath ?? ffmpegStatic;
  if (executable === null) {
    return {
      ok: false,
      message:
        "No ffmpeg is available on this host, so the panel video was not encoded.",
    };
  }

  if (options.verifyForTest !== true) {
    const verification = verifyFfmpeg({
      binaryPath: executable,
      version: FFMPEG_STATIC_VERSION,
      platform: process.platform,
      arch: process.arch,
      hashes: ffmpegHashes,
    });
    if (!verification.ok) return { ok: false, message: verification.message };
  }

  const directory = await mkdtemp(
    path.join(os.tmpdir(), "yunari-panel-video-"),
  );
  try {
    const input = path.join(directory, "in.mp4");
    const output = path.join(directory, "out.mp4");
    await writeFile(input, bytes);

    const outcome = await (options.run ?? runFfmpeg(executable))(
      encodeArgs(input, output, placement),
    );
    if (outcome.code !== 0) {
      return {
        ok: false,
        message: `The panel video could not be encoded; ffmpeg exited with code ${outcome.code}.`,
      };
    }

    let encoded: Uint8Array;
    try {
      encoded = new Uint8Array(await readFile(output));
    } catch {
      return {
        ok: false,
        message: "ffmpeg finished but wrote no panel video.",
      };
    }

    // A cache that cannot be written is not a failed transcode.
    await mkdir(CACHE_DIRECTORY, { recursive: true }).catch(() => undefined);
    await writeFile(cachePath, encoded).catch(() => undefined);

    return { ok: true, bytes: encoded };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }
}

function cached(key: string): string {
  return path.join(CACHE_DIRECTORY, `${key}.mp4`);
}

function sha256(bytes: Uint8Array, placement: PanelVideoPlacement): string {
  return createHash("sha256")
    .update(bytes)
    .update(`\0${placement.offsetX},${placement.offsetY}`)
    .digest("hex");
}

/**
 * Cover 800×480, then pan the crop the way the theme authored it.
 *
 * Scaling to cover leaves an overhang on one axis; the authored offset moves
 * through it, and a source whose aspect already matches has no overhang, so the
 * offset is clipped away. `force_divisible_by=2` keeps the H.264 frame even.
 */
function encodeArgs(
  input: string,
  output: string,
  placement: PanelVideoPlacement,
): string[] {
  const offsetX = Number.isFinite(placement.offsetX) ? placement.offsetX : 0;
  const offsetY = Number.isFinite(placement.offsetY) ? placement.offsetY : 0;

  const pan =
    offsetX === 0 && offsetY === 0
      ? "crop=800:480"
      : "crop=800:480:" +
        `x='clip((in_w-800)*(0.5-(${offsetX})),0,in_w-800)':` +
        `y='clip((in_h-480)*(0.5-(${offsetY})),0,in_h-480)'`;

  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    input,
    "-an",
    "-vf",
    `scale=800:480:force_original_aspect_ratio=increase:force_divisible_by=2,${pan}`,
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "23",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    output,
  ];
}

function runFfmpeg(executable: string): Run {
  return (args) =>
    new Promise((resolve) => {
      execFile(
        executable,
        [...args],
        { windowsHide: true, maxBuffer: MAX_STDERR_BYTES },
        (error, _stdout, stderr) => {
          const code =
            error === null
              ? 0
              : typeof (error as { code?: unknown }).code === "number"
                ? (error as { code: number }).code
                : 1;
          resolve({ code, stderr: typeof stderr === "string" ? stderr : "" });
        },
      );
    });
}
