import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import {
  readVideoFacts,
  VIDEO_LIMITS,
  type VideoFacts,
  videoRefusals,
} from "@yunari/theme-package";
import ffmpegStatic from "ffmpeg-static";
import ffmpegHashes from "../../../../../../ffmpeg-static-hashes.json";
import { verifyFfmpeg } from "./ffmpeg-hash.mjs";

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

/** The executable does not change under a running host, so one answer per path
 *  is enough and the digest is read once. */
const verificationCache = new Map<string, boolean>();

type Run = (
  args: readonly string[],
) => Promise<{ code: number; stderr: string }>;

/**
 * Test seam: the cases that spawn a fake executable supply one, so a fixture
 * does not need a digest recorded for it.
 */
export type Verify = (input: {
  readonly binaryPath: string;
  readonly version: string;
  readonly platform: string;
  readonly arch: string;
  readonly hashes: {
    readonly version: string;
    readonly sha256: Readonly<Record<string, string>>;
  };
}) => { readonly ok: true } | { readonly ok: false; readonly message: string };

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
    readonly ffmpegPath?: string;
    readonly run?: Run;
    readonly verify?: Verify;
  } = {},
): Promise<NormalizeResult> {
  const facts = readVideoFacts(bytes);
  if (facts === undefined)
    return {
      ok: false,
      message: "That video cannot be read; an H.264 MP4 is required.",
    };
  if (videoRefusals("video", facts).length === 0)
    return { ok: true, bytes, reencoded: false };

  // Decided before the encoder runs: a copy is lossless, and the output is
  // still re-probed below because these flags are a promise rather than proof.
  const copyOnly = copyRemuxSuffices(facts);
  // Refused before the encoder is even resolved: a 31-second loop is not made
  // conforming by re-encoding it, and trimming it would discard the author's
  // footage silently.
  if (facts.durationMs > VIDEO_LIMITS.maxDurationMs)
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
  if (!verified(executable, options.verify))
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
        : ffmpegArgs(input, output, facts, fit, options.aspect),
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

export function ffmpegArgs(
  input: string,
  output: string,
  facts: VideoFacts,
  fit: "cover" | "contain",
  aspect?: NormalizeAspect,
): string[] {
  const box = targetBox(facts, fit, aspect);
  const cap = bitrateCap(Math.max(box.width, box.height));
  return [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-i",
    input,
    "-an",
    "-vf",
    scaleFilter(facts, fit, aspect),
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
    // CRF alone lets a hard 4K frame spend more than the asset cap allows.
    // Capping the rate keeps 30 s inside 80 MiB and still lets easy scenes
    // spend far less than the cap.
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

/** The capped-CRF ladder, in bits per second, by the output's long edge. */
function bitrateCap(longEdge: number): number {
  if (longEdge <= 1920) return 6_000_000;
  if (longEdge <= 2560) return 12_000_000;
  return 20_000_000;
}

/**
 * The capped, even box a re-encode lands in.
 *
 * `contain` derives the box from the source, so the whole frame survives and
 * only the long edge is capped. `cover` is the author's explicit "fill the
 * artboard" press, so it derives the box from the theme's declared artboard
 * aspect and crops the centre: an explicit request is the one crop that is not
 * a silent bake, and the author can re-normalize after an artboard edit
 * (spec rule 1 rules out the implicit version of this).
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

/** The spawn gate. A supplied `verify` bypasses the cache so two cases using
 *  the same stub path cannot inherit each other's answer. */
function verified(executable: string, verify: Verify | undefined): boolean {
  const check = (): boolean =>
    (verify ?? verifyFfmpeg)({
      binaryPath: executable,
      version: FFMPEG_STATIC_VERSION,
      platform: process.platform,
      arch: process.arch,
      hashes: ffmpegHashes,
    }).ok;
  if (verify !== undefined) return check();
  const cached = verificationCache.get(executable);
  if (cached !== undefined) return cached;
  const accepted = check();
  verificationCache.set(executable, accepted);
  return accepted;
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
