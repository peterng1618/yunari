import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { placement } from "@yunari/scene-fabric";
import { readVideoFacts } from "@yunari/theme-package";
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

/**
 * Where a caller with no host directory keeps the cache. Production passes the
 * host's own cache folder; the temp fallback only serves tests and direct use,
 * because temp cleanup would throw away work the host could keep.
 */
const DEFAULT_CACHE_DIRECTORY = path.join(os.tmpdir(), "yunari-panel-video");
/** Moves whenever the ffmpeg arguments or filter change: an output encoded by
 *  an older transform is not this clip, so it must not be served. */
const TRANSCODE_VERSION = "v1";
/**
 * The cache's byte bound. Theme clips are multi-megabyte, so a count cap alone
 * could hold gigabytes; 256 MiB keeps dozens of distinct clips and evicts by
 * last use once a library grows past it.
 */
const PANEL_VIDEO_CACHE_BYTES = 256 * 1024 * 1024;

/** Numbers one scratch file within this process, so two encodes cannot collide. */
let scratchCount = 0;

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
    /** The host's disposable cache directory; temp when the caller has none. */
    readonly cacheDir?: string;
  } = {},
): Promise<TranscodeResult> {
  const placement = options.placement ?? { offsetX: 0, offsetY: 0 };
  const cacheDirectory = options.cacheDir ?? DEFAULT_CACHE_DIRECTORY;
  const cachePath = cached(cacheDirectory, sha256(bytes, placement));

  // The pan changes the pixels, so it is part of the key: the same source
  // authored at a different offset is a different clip.
  const cachedBytes = await readFile(cachePath).catch(() => undefined);
  if (cachedBytes !== undefined) {
    // A hit is a use: eviction drops the least recently used clip first.
    const used = new Date();
    await utimes(cachePath, used, used).catch(() => undefined);
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
      encodeArgs(input, output, panelFilter(bytes, placement)),
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

    // A cache that cannot be written is not a failed transcode. The scratch
    // file is renamed into place only once fsync says it is whole, so an
    // interrupted write leaves a `.tmp` nobody reuses rather than a truncated
    // clip under the key a later run would trust.
    await writeAtomic(cacheDirectory, cachePath, encoded).catch(
      () => undefined,
    );
    await evict(cacheDirectory, cachePath).catch(() => undefined);

    return { ok: true, bytes: encoded };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }
}

function cached(directory: string, key: string): string {
  return path.join(directory, `${TRANSCODE_VERSION}-${key}.mp4`);
}

/**
 * Writes `data` to `file` through a sibling scratch file.
 *
 * The bytes are fsynced before the rename, and the rename is one filesystem
 * operation within the destination's own directory. A failed write removes its
 * scratch; a crash leaves one behind, and no reader ever looks at a `.tmp` name.
 */
async function writeAtomic(
  directory: string,
  file: string,
  data: Uint8Array,
): Promise<void> {
  await mkdir(directory, { recursive: true });

  scratchCount += 1;
  const scratch = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${scratchCount}.tmp`,
  );

  const handle = await open(scratch, "w");
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await rename(scratch, file);
  } catch (error) {
    await rm(scratch, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Drops the least recently used cached clips until the directory fits the bound.
 *
 * Only names this cache writes are candidates, so a scratch file or an unrelated
 * file a person put in the cache directory is never counted or deleted. The
 * file just written is kept even if it alone is over the bound: evicting the
 * answer the caller is about to use would make a large clip re-encode forever.
 */
async function evict(directory: string, keep: string): Promise<void> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return;
  }

  const entries: { file: string; size: number; used: number }[] = [];

  for (const name of names) {
    if (!name.startsWith(`${TRANSCODE_VERSION}-`) || !name.endsWith(".mp4")) {
      continue;
    }

    const file = path.join(directory, name);
    try {
      const info = await stat(file);
      entries.push({ file, size: info.size, used: info.mtimeMs });
    } catch {
      // A file that vanished is already gone; it costs nothing to skip.
    }
  }

  let total = entries.reduce((sum, entry) => sum + entry.size, 0);
  entries.sort((first, second) => first.used - second.used);

  for (const entry of entries) {
    if (total <= PANEL_VIDEO_CACHE_BYTES) break;
    if (entry.file === keep) continue;

    try {
      await unlink(entry.file);
      total -= entry.size;
    } catch {
      // Losing an eviction to a concurrent reader is fine: the next write
      // prunes again.
    }
  }
}

function sha256(bytes: Uint8Array, placement: PanelVideoPlacement): string {
  return createHash("sha256")
    .update(bytes)
    .update(`\0${placement.offsetX},${placement.offsetY}`)
    .digest("hex");
}

/**
 * The source-pixel window the panel's 800×480 box sees, from the one placement
 * owner `scene-fabric` uses.
 *
 * The player scales the source to `placement()`'s rect and clips it to the box;
 * a crop of the same window in source pixels, scaled to the box, shows the same
 * picture. Deriving it here rather than re-stating the pan formula is what keeps
 * the panel and the player on the same edge.
 */
export interface PanelCrop {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const BOX = { width: 800, height: 480 } as const;

export function panelCrop(
  source: { readonly width: number; readonly height: number },
  offsetX: number,
  offsetY: number,
): PanelCrop {
  const rect = placement({
    box: BOX,
    source,
    offsetX: Number.isFinite(offsetX) ? offsetX : 0,
    offsetY: Number.isFinite(offsetY) ? offsetY : 0,
  });

  const scaleX = rect.width / source.width;
  const scaleY = rect.height / source.height;
  const width = Math.max(1, Math.round(BOX.width / scaleX));
  const height = Math.max(1, Math.round(BOX.height / scaleY));

  return {
    x: clamp(
      Math.round(-rect.left / scaleX),
      0,
      Math.max(0, source.width - width),
    ),
    y: clamp(
      Math.round(-rect.top / scaleY),
      0,
      Math.max(0, source.height - height),
    ),
    width,
    height,
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/**
 * The decode-and-fit filter: the authored pan when the source size is known,
 * centred cover when the facts cannot be read.
 */
function panelFilter(
  bytes: Uint8Array,
  placement: PanelVideoPlacement,
): string {
  const facts = readVideoFacts(bytes);

  if (facts === undefined || facts.width <= 0 || facts.height <= 0) {
    return "scale=800:480:force_original_aspect_ratio=increase:force_divisible_by=2,crop=800:480";
  }

  const crop = panelCrop(
    { width: facts.width, height: facts.height },
    placement.offsetX,
    placement.offsetY,
  );

  return `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},scale=800:480`;
}

function encodeArgs(input: string, output: string, filter: string): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "error",
    "-y",
    "-i",
    input,
    "-an",
    "-vf",
    filter,
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
