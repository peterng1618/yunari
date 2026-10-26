import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * @typedef {{ ok: true } | { ok: false, message: string }} VerifyResult
 * @typedef {{ version: string, sha256: Record<string, string> }} FfmpegHashes
 * @typedef {{
 *   binaryPath: string,
 *   version: string,
 *   platform: string,
 *   arch: string,
 *   hashes: FfmpegHashes,
 * }} VerifyInput
 */

/**
 * The one hash check behind both the host's spawn gate and
 * `scripts/verify-ffmpeg.mjs`.
 *
 * It lives here, in the host package, because the host is the code that runs
 * the binary; the root script is the command-line surface. It is `.mjs` rather
 * than `.ts` because that script runs under plain `node` and cannot import
 * TypeScript; the host's `allowJs` compiles it like the rest of the package.
 *
 * The message names the expected and actual digest (or the missing key) and
 * never the file's bytes, so it is safe to print.
 *
 * @param {VerifyInput} input
 * @returns {VerifyResult}
 */
export function verifyFfmpeg({ binaryPath, version, platform, arch, hashes }) {
  // A bumped package must be a visible edit to the hash file, not a silently
  // unverified binary: the old digests do not describe the new download.
  if (hashes.version !== version) {
    return {
      ok: false,
      message:
        `ffmpeg-static ${version} is installed but ffmpeg-static-hashes.json ` +
        `records ${hashes.version}; update the file with the new binaries.`,
    };
  }

  // An unlisted platform is not a verified platform, so it is refused rather
  // than waved through with the nearest digest.
  const key = `${platform}-${arch}`;
  const expected = hashes.sha256[key];
  if (expected === undefined) {
    return {
      ok: false,
      message: `ffmpeg-static ${version} has no recorded SHA-256 for ${key}.`,
    };
  }

  let bytes;
  try {
    bytes = readFileSync(binaryPath);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
    return {
      ok: false,
      message:
        code === "ENOENT"
          ? `the ffmpeg-static binary is missing at ${binaryPath}.`
          : `the ffmpeg-static binary at ${binaryPath} cannot be read.`,
    };
  }

  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) {
    return {
      ok: false,
      message: `ffmpeg-static ${version} ${key}: expected ${expected}, got ${actual}.`,
    };
  }
  return { ok: true };
}
