import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import {
  readVideoFacts,
  VIDEO_LIMITS,
  VIDEO_TRIM,
  type VideoFacts,
  type VideoTrimRange,
  videoRefusals,
} from "@yunari/theme-package";
import ffmpegStatic from "ffmpeg-static";
import ffmpegHashes from "../../../../../../ffmpeg-static-hashes.json";
import { verifyFfmpeg } from "./ffmpeg-hash.mjs";
import { MAX_ASSET_BYTES } from "./store.js";

/**
 * Brings a source video inside the publish envelope, or copies it untouched.
 *
 * A conforming file is returned as the same bytes object: re-encoding an asset
 * that already passes would degrade it a little on every resubmission. A file
 * longer than the envelope is refused rather than truncated, because a cut
 * background loop is not the one the author made.
 *
 * Audio and missing `+faststart` are fixed by a stream copy, not an encode:
 * neither touches the picture, and a re-encode would spend quality to remove a
 * track the author never sees. Everything else re-encodes with a capped-CRF
 * ladder sized to the resolution, so a 30 s 4K loop stays inside the asset cap.
 */

const USAGE = "usage: yunari normalize-video <input.mp4> <output.mp4>";
/** ffmpeg's own progress output goes to stderr; a hang or a runaway log must
 *  not outgrow the child-process buffer. */
const MAX_STDERR_BYTES = 4 * 1024 * 1024;

/** The ffmpeg rate the envelope requires. */
const FRAMES_PER_SECOND = 30;

/** The installed package's own version. The hash file is keyed by it, so a bump
 *  refuses rather than verifying against digests for some other build. */
const FFMPEG_STATIC_VERSION: string = createRequire(import.meta.url)(
  "ffmpeg-static/package.json",
).version;

/** Any verification failure earns this sentence: the expected and actual
 *  digest belongs in the CLI's output, not in a user's error toast. */
const HASH_REFUSAL =
  "The bundled ffmpeg does not match the hash recorded for this platform, " +
  "so the video was not re-encoded.";

type Run = (
  args: readonly string[],
) => Promise<{ code: number; stderr: string }>;

/**
 * Test seam for `verifyFfmpeg`, named so production code cannot mistake it for
 * an option: the cases that spawn a fake executable supply one, so a fixture
 * does not need a digest recorded for it. The only caller outside tests is the
 * default. The shape is the verifier's own, so there is one definition.
 */
export type Verify = typeof verifyFfmpeg;

export type NormalizeResult =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      readonly reencoded: boolean;
    }
  | { readonly ok: false; readonly message: string };

/** The framing shape `cover` crops to, e.g. 16:9. */
export interface NormalizeAspect {
  readonly width: number;
  readonly height: number;
}

export async function normalizeVideo(
  bytes: Uint8Array,
  options: {
    readonly fit?: "cover" | "contain";
    readonly aspect?: NormalizeAspect;
    /** A span of the source to keep. Trimming always re-encodes and always
     *  blends the loop seam; a re-encode that is not a trim does neither. */
    readonly trim?: VideoTrimRange;
    readonly ffmpegPath?: string;
    readonly run?: Run;
    readonly verifyForTest?: Verify;
  } = {},
): Promise<NormalizeResult> {
  const facts = readVideoFacts(bytes);
  if (facts === undefined)
    return {
      ok: false,
      message: "That video cannot be read; an H.264 MP4 is required.",
    };

  const trimmed =
    options.trim === undefined ? undefined : trimOf(facts, options.trim);
  if (typeof trimmed === "string") return { ok: false, message: trimmed };
  if (trimmed !== undefined && trimmed.spanMs > VIDEO_LIMITS.maxDurationMs)
    return {
      ok: false,
      message:
        `That selection is ${trimmed.spanMs} ms long; the maximum is ` +
        `${VIDEO_LIMITS.maxDurationMs} ms.`,
    };

  // An untrimmed, conforming file is copied byte for byte. A trimmed span is
  // always re-encoded: the cut and the blend cannot be a stream copy.
  if (trimmed === undefined && videoRefusals("video", facts).length === 0)
    return { ok: true, bytes, reencoded: false };

  // Decided before the encoder runs: a copy is lossless, and the output is
  // still re-probed below because these flags are a promise rather than proof.
  const copyOnly = trimmed === undefined && copyRemuxSuffices(facts);
  // Refused before the encoder is even resolved: a 61-second loop is not made
  // conforming by re-encoding it, and trimming it would discard the author's
  // footage silently.
  if (trimmed === undefined && facts.durationMs > VIDEO_LIMITS.maxDurationMs)
    return {
      ok: false,
      message:
        `That video is ${facts.durationMs} ms long; the maximum is ` +
        `${VIDEO_LIMITS.maxDurationMs} ms. Trim it and try again.`,
    };

  const fit = options.fit ?? "contain";
  if (fit === "cover" && !validAspect(options.aspect))
    return {
      ok: false,
      message:
        "cover needs an aspect (a positive width and height) to crop to; " +
        "contain preserves the source aspect.",
    };

  const executable = options.ffmpegPath ?? ffmpegStatic;
  if (executable === null)
    return {
      ok: false,
      message:
        "No ffmpeg encoder is available on this host, so the video cannot be re-encoded.",
    };
  // The bytes this host is about to execute come from an install-time download
  // that npm's tarball integrity does not cover; nothing else checks them.
  if (!verified(executable, options.verifyForTest))
    return { ok: false, message: HASH_REFUSAL };
  const run = options.run ?? encoderRun(executable);

  // A directory per run, under the OS temp root: two normalizations at once
  // cannot overwrite each other's files, and nothing is left behind either way.
  const directory = await mkdtemp(path.join(os.tmpdir(), "yunari-normalize-"));
  try {
    const input = path.join(directory, "in.mp4");
    const output = path.join(directory, "out.mp4");
    await writeFile(input, bytes);
    const outcome = await run(
      copyOnly
        ? remuxArgs(input, output)
        : ffmpegArgs(input, output, facts, fit, options.aspect, trimmed),
    );
    // The child's stderr can carry paths and encoder internals; the sentence
    // names the failure without echoing them.
    if (outcome.code !== 0)
      return {
        ok: false,
        message: `That video could not be re-encoded; ffmpeg exited with code ${outcome.code}.`,
      };
    // The encoder's flags are a promise, not proof: re-probe what it wrote so a
    // build that ignores `-r`, `-an` or `+faststart` cannot hand the author
    // non-conforming bytes marked as success.
    const encoded = new Uint8Array(await readFile(output));
    const encodedFacts = readVideoFacts(encoded);
    if (
      encodedFacts === undefined ||
      videoRefusals("normalized", encodedFacts).length > 0
    )
      return {
        ok: false,
        message:
          "That video could not be re-encoded into the publish envelope; " +
          "the encoder's output does not conform.",
      };
    return {
      ok: true,
      bytes: encoded,
      reencoded: true,
    };
  } catch {
    return { ok: false, message: "That video could not be re-encoded." };
  } finally {
    // A cleanup failure (AV/EBUSY on Windows) must not discard the answer.
    await rm(directory, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }
}

/** The span with its two ends clamped to the source. */
interface TrimmedSpan extends VideoTrimRange {
  readonly spanMs: number;
}

/** The usable span, or the sentence naming why the trim cannot run. */
function trimOf(facts: VideoFacts, trim: VideoTrimRange): TrimmedSpan | string {
  const { startMs, endMs } = trim;
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    startMs < 0 ||
    endMs <= startMs
  )
    return "That trim is not a usable range; the end must come after the start.";

  // The editor's video element and the MP4's own timing can disagree by a
  // little; clamping is kinder than refusing a selection that reaches the end.
  const start = Math.max(0, Math.min(startMs, facts.durationMs));
  const end = Math.max(0, Math.min(endMs, facts.durationMs));
  if (end <= start)
    return "That trim is not a usable range; the end must come after the start.";

  const spanMs = end - start;
  if (spanMs < VIDEO_TRIM.minSpanMs)
    return (
      `That selection is ${spanMs} ms long; a trimmed loop needs at least ` +
      `${VIDEO_TRIM.minSpanMs} ms so the ${VIDEO_TRIM.blendMs} ms blend has room.`
    );

  return { startMs: start, endMs: end, spanMs };
}

/** A filter time, in seconds, without trailing zeros. */
function seconds(ms: number): string {
  return (ms / 1000).toFixed(6).replace(/\.?0+$/u, "");
}

export function ffmpegArgs(
  input: string,
  output: string,
  facts: VideoFacts,
  fit: "cover" | "contain",
  aspect?: NormalizeAspect,
  trim?: TrimmedSpan,
): string[] {
  const box = targetBox(facts, fit, aspect);
  const cap = bitrateCap(
    Math.max(box.width, box.height),
    trim?.spanMs ?? facts.durationMs,
  );
  // An input seek keeps a long source from being decoded up to the in point;
  // the trim's filters then run on a timeline that starts at zero.
  const seek =
    trim === undefined
      ? []
      : ["-ss", seconds(trim.startMs), "-t", seconds(trim.spanMs)];
  const picture =
    trim === undefined
      ? ["-vf", scaleFilter(facts, fit, aspect)]
      : [
          "-filter_complex",
          blendFilter(facts, fit, aspect, trim.spanMs),
          "-map",
          "[out]",
        ];

  return [
    "-hide_banner",
    "-nostdin",
    "-y",
    ...seek,
    "-i",
    input,
    "-an",
    ...picture,
    "-r",
    String(FRAMES_PER_SECOND),
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "23",
    // CRF alone lets a hard 4K frame spend more than the asset cap allows.
    // Capping the rate keeps the whole duration inside the per-asset bound and
    // still lets easy scenes spend far less than the cap.
    "-maxrate",
    String(cap),
    "-bufsize",
    String(cap * 2),
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    output,
  ];
}

/**
 * The loop's dissolve, as one filter graph.
 *
 * The first `VIDEO_TRIM.blendMs` of the span is the head; the rest is the
 * body. The body plays to its end, then dissolves into the head over the same
 * length. At the end of that dissolve the picture is the head's last frame,
 * which is the body's first frame, so the file's own loop point is continuous.
 * The output is one blend shorter than the span. `fps` and `format` are stated
 * before the split because `xfade` requires both inputs to agree on them.
 */
function blendFilter(
  facts: VideoFacts,
  fit: "cover" | "contain",
  aspect: NormalizeAspect | undefined,
  spanMs: number,
): string {
  const blend = seconds(VIDEO_TRIM.blendMs);
  const offset = seconds(spanMs - VIDEO_TRIM.blendMs * 2);
  return (
    `[0:v]fps=${FRAMES_PER_SECOND},format=yuv420p,split=2[body][head];` +
    `[body]trim=start=${blend},setpts=PTS-STARTPTS[bodyv];` +
    `[head]trim=end=${blend},setpts=PTS-STARTPTS[headv];` +
    `[bodyv][headv]xfade=transition=fade:duration=${blend}:offset=${offset}[xf];` +
    `[xf]${scaleFilter(facts, fit, aspect)}[out]`
  );
}

/** A copy that drops audio and moves `moov` forward, for the two faults that
 *  do not touch the picture. `-c:v copy` keeps the encoder out of it. */
function remuxArgs(input: string, output: string): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-i",
    input,
    "-an",
    "-c:v",
    "copy",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    output,
  ];
}

/** The file's only faults are audio and/or faststart, so a copy can fix it. */
function copyRemuxSuffices(facts: VideoFacts): boolean {
  return (
    videoRefusals("video", { ...facts, hasAudio: false, faststart: true })
      .length === 0
  );
}

/** The capped-CRF ladder, in bits per second, by the output's long edge. The
 *  duration-aware half is the asset bound: a 60-second clip at the 4K ladder's
 *  20 Mb/s would be 150 MB, so the rate is lowered until 90% of the bound is
 *  enough for the whole clip. */
function bitrateCap(longEdge: number, durationMs: number): number {
  const ladder =
    longEdge <= 1920 ? 6_000_000 : longEdge <= 2560 ? 12_000_000 : 20_000_000;
  const seconds = Math.max(durationMs, 1_000) / 1000;
  const bound = Math.floor((MAX_ASSET_BYTES * 0.9 * 8) / seconds);
  return Math.max(500_000, Math.min(ladder, bound));
}

/**
 * The capped, even box a re-encode lands in.
 *
 * `contain` derives the box from the source, so the whole frame survives and
 * only the long edge is capped. `cover` is the author's explicit "fill the
 * artboard" press, so it derives the box from the theme's declared artboard
 * aspect and crops the centre: an explicit request is the one crop that is not
 * a silent bake, and the author can re-normalize after an artboard edit
 * (the implicit version of this is ruled out).
 */
function scaleFilter(
  facts: VideoFacts,
  fit: "cover" | "contain",
  aspect: NormalizeAspect | undefined,
): string {
  const box = targetBox(facts, fit, aspect);
  return fit === "cover"
    ? `scale=${box.width}:${box.height}:force_original_aspect_ratio=increase:force_divisible_by=2,crop=${box.width}:${box.height}`
    : `scale=${box.width}:${box.height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${box.width}:${box.height}:(ow-iw)/2:(oh-ih)/2:color=black`;
}

/** The box the output lands in: the aspect's for `cover`, the source's for
 *  `contain`. One owner, so the scale filter and the rate cap agree. */
function targetBox(
  facts: VideoFacts,
  fit: "cover" | "contain",
  aspect: NormalizeAspect | undefined,
): { readonly width: number; readonly height: number } {
  return fit === "cover" && validAspect(aspect)
    ? boxForAspect(aspect)
    : boxForSource(facts.width, facts.height);
}

/** The source box, capped at the long edge and never upscaled. */
function boxForSource(
  width: number,
  height: number,
): { readonly width: number; readonly height: number } {
  const longEdge = Math.max(width, height);
  const factor =
    longEdge > VIDEO_LIMITS.maxLongEdge
      ? VIDEO_LIMITS.maxLongEdge / longEdge
      : 1;
  return {
    width: evenAtMost(width * factor),
    height: evenAtMost(height * factor),
  };
}

/** The requested ratio, always mapped to the full long edge: a cover box is a
 *  framing, so it is the same wherever the source started. */
function boxForAspect(aspect: NormalizeAspect): {
  readonly width: number;
  readonly height: number;
} {
  const factor =
    VIDEO_LIMITS.maxLongEdge / Math.max(aspect.width, aspect.height);
  return {
    width: evenAtMost(aspect.width * factor),
    height: evenAtMost(aspect.height * factor),
  };
}

function validAspect(
  aspect: NormalizeAspect | undefined,
): aspect is NormalizeAspect {
  return (
    aspect !== undefined &&
    Number.isFinite(aspect.width) &&
    Number.isFinite(aspect.height) &&
    aspect.width > 0 &&
    aspect.height > 0
  );
}

function evenAtMost(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2);
}

/** The spawn gate. Verification runs at every spawn rather than once per path:
 *  `readFileSync` then `execFile` reopen the path, so a cache would let a
 *  binary replaced after the first check run unhashed for the rest of the
 *  process. Reading the binary costs milliseconds against a re-encode's
 *  minutes; a cache added here must be documented as that ceiling. */
function verified(executable: string, verify: Verify | undefined): boolean {
  return (verify ?? verifyFfmpeg)({
    binaryPath: executable,
    version: FFMPEG_STATIC_VERSION,
    platform: process.platform,
    arch: process.arch,
    hashes: ffmpegHashes,
  }).ok;
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
            resolve({ code: 0, stderr: "" });
            return;
          }
          // `error.code` is a number for a non-zero exit and a string (ENOENT,
          // EACCES) for a spawn failure; both are a failure here.
          const code = (error as { code?: unknown }).code;
          resolve({
            code: typeof code === "number" ? code : 1,
            stderr: typeof stderr === "string" ? stderr : "",
          });
        },
      );
    });
}

/** `undefined` for every command line that is not this one, so `run` falls
 *  through to its own parser untouched. */
export async function normalizeVideoCommand(
  argv: readonly string[],
): Promise<number | undefined> {
  if (argv[0] !== "normalize-video") return undefined;

  const input = argv[1];
  const output = argv[2];
  if (input === undefined || output === undefined || argv.length > 3) {
    console.error(
      `normalize-video needs <input.mp4> and <output.mp4>.\n${USAGE}`,
    );
    return 1;
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(input));
  } catch (error) {
    console.error(`Cannot read ${input}: ${messageOf(error)}`);
    return 1;
  }

  const normalized = await normalizeVideo(bytes);
  if (!normalized.ok) {
    console.error(normalized.message);
    return 1;
  }
  try {
    await writeFile(output, normalized.bytes);
  } catch (error) {
    console.error(`Cannot write ${output}: ${messageOf(error)}`);
    return 1;
  }
  console.log(
    `${output}: ${normalized.reencoded ? "re-encoded" : "already conforms"}`,
  );
  return 0;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
