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
import {
  artboardGradientLine,
  type BackgroundMask,
  blendRampStops,
  type PalettePaint,
  resolveBackgroundComposition,
} from "@yunari/renderer-core";
import { placement } from "@yunari/scene-fabric";
import { readVideoFacts } from "@yunari/theme-package";
import ffmpegStatic from "ffmpeg-static";
import ffmpegHashes from "../../../../../../ffmpeg-static-hashes.json";
import { verifyFfmpeg } from "../themes/ffmpeg-hash.mjs";
import type { PanelVideoPlacement } from "./panel-device.js";
import {
  type PanelVideoTurn,
  turnedBox,
  turnFilter,
  turnRefusal,
  videoTurn,
} from "./panel-video-turn.js";

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
const TRANSCODE_VERSION = "v2";
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
    /** Whole degrees clockwise the display turns the composition. */
    readonly rotation?: number;
    /** The host's disposable cache directory; temp when the caller has none. */
    readonly cacheDir?: string;
  } = {},
): Promise<TranscodeResult> {
  const placement = options.placement ?? { offsetX: 0, offsetY: 0 };
  const cacheDirectory = options.cacheDir ?? DEFAULT_CACHE_DIRECTORY;
  const turn = videoTurn(options.rotation ?? 0);
  if (turn === undefined) {
    return { ok: false, message: turnRefusal(options.rotation ?? 0) };
  }

  const cachePath = cached(cacheDirectory, sha256(bytes, placement, turn));

  // The pan and the turn change the pixels, so both are part of the key: the
  // same source authored at another offset or played on another mount is a
  // different clip.
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
      encodeArgs(input, output, panelFilter(bytes, placement, turn)),
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

function sha256(
  bytes: Uint8Array,
  placement: PanelVideoPlacement,
  turn: PanelVideoTurn,
): string {
  return createHash("sha256")
    .update(bytes)
    .update(`\0${turn}\0${JSON.stringify(placement)}`)
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
  box: { readonly width: number; readonly height: number } = BOX,
  scale?: number,
): PanelCrop {
  const rect = placement({
    box,
    source,
    offsetX: Number.isFinite(offsetX) ? offsetX : 0,
    offsetY: Number.isFinite(offsetY) ? offsetY : 0,
    ...(scale === undefined ? {} : { scale }),
  });

  const scaleX = rect.width / source.width;
  const scaleY = rect.height / source.height;
  const width = Math.max(1, Math.round(box.width / scaleX));
  const height = Math.max(1, Math.round(box.height / scaleY));

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
 * centred cover when the facts cannot be read, then the display's own turn.
 *
 * **A quarter turn swaps the box the layer is laid out in.** The player fits a
 * display-bounded media layer to a box turned with the composition — 480×800
 * on a 90° mount, then the layer itself turns about its centre and covers the
 * 800×480 glass. Turning the source before the crop would show a different part
 * of the clip, so the crop window is the turned box's and the turn comes last.
 *
 * A composition is one question more: where the media sits, what fills the rest
 * and how the seam fades. That graph is built in the same turned box, so the
 * bake and the page describe one picture.
 */
interface EncodeFilter {
  readonly filter: string;
  readonly complex: boolean;
  /** The composed graph's fill and mask never end, so the output needs the
   *  source's own duration; the plain path takes its length from the input. */
  readonly durationSeconds?: number;
}

function panelFilter(
  bytes: Uint8Array,
  placement: PanelVideoPlacement,
  turn: PanelVideoTurn,
): EncodeFilter {
  const box = turnedBox(BOX, turn);
  const facts = readVideoFacts(bytes);
  const composed =
    placement.composition !== undefined || placement.fill !== undefined;

  if (!composed) {
    return {
      filter: plainFilter(facts, placement, box, turn),
      complex: false,
    };
  }

  return {
    filter: composedFilter(facts, placement, box, turn),
    complex: true,
    ...(facts === undefined || !(facts.durationMs > 0)
      ? {}
      : { durationSeconds: facts.durationMs / 1000 }),
  };
}

function plainFilter(
  facts: { readonly width: number; readonly height: number } | undefined,
  placement: PanelVideoPlacement,
  box: { readonly width: number; readonly height: number },
  turn: PanelVideoTurn,
): string {
  const turnSuffix = turnFilter(turn);

  if (facts === undefined || facts.width <= 0 || facts.height <= 0) {
    return (
      `scale=${box.width}:${box.height}:force_original_aspect_ratio=increase` +
      `:force_divisible_by=2,crop=${box.width}:${box.height}${turnSuffix}`
    );
  }

  const crop = panelCrop(
    { width: facts.width, height: facts.height },
    placement.offsetX,
    placement.offsetY,
    box,
    placement.scale,
  );

  return `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},scale=${box.width}:${box.height}${turnSuffix}`;
}

/**
 * The composed graph, in the turned box and with the turn applied last.
 *
 * One mask line decides every surface, so the host reads the resolver's own
 * geometry rather than re-deriving the ramp. The fill covers the whole box; the
 * media is cropped to the region's cover, scaled to the region, masked, and laid
 * over the fill at the region's offset.
 */
function composedFilter(
  facts: { readonly width: number; readonly height: number } | undefined,
  placement: PanelVideoPlacement,
  box: { readonly width: number; readonly height: number },
  turn: PanelVideoTurn,
): string {
  const composition = resolveBackgroundComposition(
    { width: box.width, height: box.height },
    placement.composition,
    facts,
  );
  const region = composition.region;
  const width = Math.max(1, Math.round(region.width));
  const height = Math.max(1, Math.round(region.height));
  const x = Math.max(0, Math.round(region.left));
  const y = Math.max(0, Math.round(region.top));

  const media =
    facts === undefined || facts.width <= 0 || facts.height <= 0
      ? `scale=${width}:${height}:force_original_aspect_ratio=increase:force_divisible_by=2,crop=${width}:${height}`
      : (() => {
          const crop = panelCrop(
            { width: facts.width, height: facts.height },
            placement.offsetX,
            placement.offsetY,
            { width: region.width, height: region.height },
            placement.scale,
          );
          return `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},scale=${width}:${height}`;
        })();

  const parts = [
    `[0:v]${media}[media]`,
    `${fillSource(placement.fill, box.width, box.height)}[fill]`,
  ];

  let overlayInput = "media";
  for (const [index, mask] of composition.masks.entries()) {
    parts.push(
      `${maskSource(mask, x, y, width, height)}[mask${String(index)}]`,
      `[${overlayInput}][mask${String(index)}]alphamerge[composed${String(index)}]`,
    );
    overlayInput = `composed${String(index)}`;
  }

  const turnStep = turnFilter(turn);
  parts.push(
    `[fill][${overlayInput}]overlay=x=${x}:y=${y}:shortest=1[turned]`,
    `[turned]${turnStep === "" ? "null" : turnStep.slice(1)}[out]`,
  );
  return parts.join(";");
}

/** A solid or linear-gradient source covering the whole box. */
function fillSource(
  fill: PalettePaint | undefined,
  width: number,
  height: number,
): string {
  if (fill === undefined) return `color=c=0x000000:s=${width}x${height}`;
  if (fill.kind === "solid")
    return `color=c=${ffmpegColor(fill.color)}:s=${width}x${height}`;

  const colors = gradientColors(fill.stops);
  const line = artboardGradientLine(fill, width, height);
  const stops = colors.map((color, index) => `c${index}=${color}`).join(":");
  return (
    `gradients=s=${width}x${height}:${stops}:nb_colors=${colors.length}` +
    `:x0=${Math.round(line.x1)}:y0=${Math.round(line.y1)}` +
    `:x1=${Math.round(line.x2)}:y1=${Math.round(line.y2)}`
  );
}

/**
 * ffmpeg's `gradients` spaces its colours evenly and holds at most eight. A
 * longer authored ramp is sampled at eight even positions; a palette gradient
 * with more stops than that is rare and the shape is kept.
 */
function gradientColors(
  stops: readonly { readonly offset: number; readonly color: string }[],
): readonly string[] {
  const ordered = [...stops].sort((a, b) => a.offset - b.offset);
  if (ordered.length <= 8)
    return ordered.map((stop) => ffmpegColor(stop.color));
  return Array.from({ length: 8 }, (_, index) =>
    ffmpegColor(ordered[Math.round((index * (ordered.length - 1)) / 7)]!.color),
  );
}

function ffmpegColor(color: string): string {
  return color.startsWith("#") ? `0x${color.slice(1)}` : color;
}

/**
 * One alpha ramp, sized to the region and shifted by the region's own offset.
 * The stops are the shared eased ramp in grayscale, so the bake draws the same
 * curve as the DOM and the glass instead of a linear ramp with visible ends.
 */
function maskSource(
  mask: BackgroundMask,
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  const stops = blendRampStops();
  const colors = stops
    .map((stop, index) => {
      const value = Math.round(stop.alpha * 255)
        .toString(16)
        .padStart(2, "0");
      return `c${String(index)}=0x${value}${value}${value}`;
    })
    .join(":");
  return (
    `gradients=s=${width}x${height}:${colors}:nb_colors=${String(stops.length)}` +
    `:x0=${Math.round(mask.x1 - x)}:y0=${Math.round(mask.y1 - y)}` +
    `:x1=${Math.round(mask.x2 - x)}:y1=${Math.round(mask.y2 - y)}`
  );
}

function encodeArgs(
  input: string,
  output: string,
  filter: EncodeFilter,
): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "error",
    "-y",
    "-i",
    input,
    "-an",
    ...(filter.complex
      ? ["-filter_complex", filter.filter, "-map", "[out]"]
      : ["-vf", filter.filter]),
    ...(filter.durationSeconds === undefined
      ? []
      : ["-t", String(filter.durationSeconds)]),
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
