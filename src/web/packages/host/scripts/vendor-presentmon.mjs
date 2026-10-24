import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Stages the official PresentMon console release into `packages/host/vendor/presentmon`
 * so a release can ship it. The executable is never committed: it is
 * third-party binary output, and the repository tracks its provenance instead.
 *
 * Run: `node packages/host/scripts/vendor-presentmon.mjs`
 */

const VERSION = "v2.6.0";
const ASSET = "PresentMon-2.6.0-x64.exe";
/** Pinned so the staged bytes are reproducible and auditable. */
const SHA256 = "b2a706bc6ad475749e3b7e3409263aa1e6906d45bdcf993f6dbc0f660188f1af";

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, "..", "vendor", "presentmon");
const url = `https://github.com/GameTechDev/PresentMon/releases/download/${VERSION}/${ASSET}`;
const licenceUrl = `https://raw.githubusercontent.com/GameTechDev/PresentMon/${VERSION}/LICENSE.txt`;

async function download(urlToFetch, what) {
  const response = await fetch(urlToFetch);

  if (!response.ok) {
    throw new Error(`${what} answered ${response.status}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

async function main() {
  console.log(`Downloading ${VERSION}…`);

  const executable = await download(url, url);
  const digest = createHash("sha256").update(executable).digest("hex");

  if (digest !== SHA256) {
    throw new Error(
      `Refusing to stage: expected sha256 ${SHA256}, got ${digest}. ` +
        "The release changed; review it before pinning the new digest.",
    );
  }

  // MIT requires the copyright and permission notice to travel with the
  // binary; the release asset carries no licence file of its own. Fetch it
  // before writing anything, so a failed fetch stages no incomplete pair.
  const licence = await download(licenceUrl, "LICENSE.txt");

  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });

  await writeFile(path.join(target, "PresentMon.exe"), executable);
  await writeFile(path.join(target, "LICENSE.txt"), licence);

  await writeFile(
    path.join(target, "PROVENANCE.txt"),
    [
      `PresentMon ${VERSION}`,
      `source: ${url}`,
      `sha256: ${digest}`,
      "",
      "Staged by packages/host/scripts/vendor-presentmon.mjs. Not committed.",
      "Yunari links nothing and modifies nothing; it runs the executable with",
      "--output_stdout --no_csv and parses the CSV it writes to stdout.",
      "",
      "LICENSE.txt is PresentMon's own MIT notice, added here because the",
      "release asset is a bare executable.",
      "",
    ].join("\n"),
  );

  console.log(`Staged ${VERSION} into ${target}`);
  console.log(`sha256 ${digest}`);
  console.log(
    "Release packaging must ship vendor/presentmon/LICENSE.txt with the executable.",
  );
}

await main();
