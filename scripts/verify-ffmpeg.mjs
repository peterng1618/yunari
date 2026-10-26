#!/usr/bin/env node

/**
 * Checks the installed `ffmpeg-static` binary against `ffmpeg-static-hashes.json`.
 *
 * The package's install script downloads the platform binary and npm's tarball
 * integrity covers only its JavaScript, so this is the check that the bytes the
 * host is about to spawn are the bytes that were recorded. The same function is
 * the host's spawn gate (`packages/host/src/themes/normalize-video.ts`), so a
 * green CLI run and an accepted re-encode cannot disagree.
 *
 * `node scripts/verify-ffmpeg.mjs`
 *
 * Its cases live in `src/web/tests/scripts/verify-ffmpeg.test.ts`, which is why
 * it takes no arguments: an argument it does not define is an error rather than
 * being ignored, so a CI step cannot read green while asking for something else.
 *
 * Exit: 0 verified, 1 version/platform/digest refusal, 2 `ffmpeg-static` or its
 * binary is unavailable, or an unknown argument.
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { verifyFfmpeg } from "../src/web/packages/host/src/themes/ffmpeg-hash.mjs";

export { verifyFfmpeg };

const ROOT = resolve(import.meta.dirname, "..");

/** The installed package's binary path and version, or the reason there is none. */
function installed() {
  // Resolved from `src/web`, where the workspace's dependency lives.
  const require = createRequire(join(ROOT, "src/web/package.json"));
  try {
    return {
      binaryPath: require("ffmpeg-static"),
      version: require("ffmpeg-static/package.json").version,
    };
  } catch (error) {
    return {
      failure:
        "ffmpeg-static is not installed" +
        (error instanceof Error ? `: ${error.message}` : ""),
    };
  }
}

/** The recorded map, or the reason it cannot be read. */
function recordedHashes() {
  try {
    return {
      hashes: JSON.parse(
        readFileSync(join(ROOT, "ffmpeg-static-hashes.json"), "utf8"),
      ),
    };
  } catch (error) {
    return {
      failure:
        "ffmpeg-static-hashes.json cannot be read" +
        (error instanceof Error ? `: ${error.message}` : ""),
    };
  }
}

function main(argv) {
  if (argv.length > 0) {
    console.error(
      `ffmpeg: unknown argument ${argv.join(" ")}; this check takes none.`,
    );
    return 2;
  }
  const { binaryPath, version, failure } = installed();
  if (failure !== undefined) {
    console.error(`ffmpeg: ${failure}`);
    return 2;
  }
  // A package without a binary for this platform (e.g. win32-arm64) is a
  // prerequisite failure, not a digest refusal.
  if (binaryPath === null) {
    console.error(
      `ffmpeg: ffmpeg-static has no binary for ${process.platform}-${process.arch}`,
    );
    return 2;
  }
  if (!existsSync(binaryPath)) {
    console.error(`ffmpeg: the ffmpeg-static binary is missing at ${binaryPath}`);
    return 2;
  }

  const { hashes, failure: unreadable } = recordedHashes();
  if (hashes === undefined) {
    console.error(`ffmpeg: ${unreadable}`);
    return 2;
  }

  const result = verifyFfmpeg({
    binaryPath,
    version,
    platform: process.platform,
    arch: process.arch,
    hashes,
  });
  if (!result.ok) {
    console.error(`ffmpeg: ${result.message}`);
    return 1;
  }
  console.log(
    `ffmpeg: ffmpeg-static ${version} ${process.platform}-${process.arch} matches its recorded SHA-256`,
  );
  return 0;
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  process.exit(main(process.argv.slice(2)));
}
