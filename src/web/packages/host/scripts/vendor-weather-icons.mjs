import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

/**
 * Stages the Meteocons `fill` icons the weather keys name into
 * `packages/host/vendor/weather-icons`, so the route serves committed bytes and
 * a release needs no network.
 *
 * The tarball is pinned by its registry URL and `sha512` integrity; a missing
 * slug fails the run rather than shrinking the allow-list silently.
 *
 * Run: `node packages/host/scripts/vendor-weather-icons.mjs`
 */

const TARBALL =
  "https://registry.npmjs.org/@meteocons/svg-static/-/svg-static-0.1.0.tgz";
/** From `npm view @meteocons/svg-static@0.1.0 dist.integrity`. */
const INTEGRITY =
  "sha512-dnuXOkt1W5q+XZbyj54dzjuBcKmsC0eLv51IVaW9kzzvzwnhwv9KgNXHKgpvmdN6cX2stMo+k95iMFbcyM4x5Q==";
const STYLE = "fill";

/** Must match `VENDORED_ICON_SLUGS` in `src/providers/weather/icons.ts`. */
const SLUGS = [
  "clear-day",
  "clear-night",
  "mostly-clear-day",
  "mostly-clear-night",
  "partly-cloudy-day",
  "partly-cloudy-night",
  "overcast-day",
  "overcast-night",
  "fog-day",
  "fog-night",
  "fog",
  "drizzle",
  "sleet",
  "rain",
  "snow",
  "partly-cloudy-day-rain",
  "partly-cloudy-night-rain",
  "partly-cloudy-day-snow",
  "partly-cloudy-night-snow",
  "thunderstorms-day",
  "thunderstorms-night",
  "thunderstorms-day-rain",
  "thunderstorms-night-rain",
];

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, "..", "vendor", "weather-icons");

async function download() {
  const response = await fetch(TARBALL);

  if (!response.ok) {
    throw new Error(`${TARBALL} answered ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;

  if (digest !== INTEGRITY) {
    throw new Error(
      `Refusing to stage: expected ${INTEGRITY}, got ${digest}. ` +
        "The package changed; review it before pinning the new integrity.",
    );
  }

  return bytes;
}

async function main() {
  const archive = await download();
  const work = await mkdtemp(path.join(tmpdir(), "yunari-weather-icons-"));

  try {
    const tarball = path.join(work, "svg-static.tgz");
    await writeFile(tarball, archive);
    // Relative archive name and cwd: GNU tar reads a drive letter in an
    // absolute Windows path as a remote host.
    await promisify(execFile)("tar", ["-xzf", "svg-static.tgz"], {
      cwd: work,
    });

    const extracted = path.join(work, "package");
    await rm(target, { recursive: true, force: true });
    await mkdir(target, { recursive: true });

    for (const slug of SLUGS) {
      const from = path.join(extracted, STYLE, `${slug}.svg`);
      // `copyFile` fails loudly on a slug the package no longer carries.
      await copyFile(from, path.join(target, `${slug}.svg`));
    }

    // The licence travels with the bytes, as the notice files promise.
    await copyFile(path.join(extracted, "LICENSE"), path.join(target, "LICENSE"));

    console.log(`Staged ${SLUGS.length} weather icons in ${target}`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

await main();
