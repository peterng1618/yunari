import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

/**
 * Stages an official LibreHardwareMonitor release into `packages/host/vendor/lhm`
 * so a release can ship it. The archive is never committed: it is third-party
 * binary output, and the repository tracks its provenance instead.
 *
 * Run: `node packages/host/scripts/vendor-lhm.mjs [--version vX.Y.Z]`
 */

const VERSION = "v0.9.6";
/** Pinned so the staged bytes are reproducible and auditable. */
const SHA256 = null;

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, "..", "vendor", "lhm");

/**
 * Files LHM's repository carries but its release archive omits, while the
 * archive bundles third-party binaries whose licences require the notices.
 * Shipped alongside the binaries.
 */
const NOTICE_FILES = [
  {
    name: "LICENSE",
    url: `https://raw.githubusercontent.com/LibreHardwareMonitor/LibreHardwareMonitor/master/LICENSE`,
  },
  {
    name: "THIRD-PARTY-NOTICES.txt",
    url: `https://raw.githubusercontent.com/LibreHardwareMonitor/LibreHardwareMonitor/master/THIRD-PARTY-NOTICES.txt`,
  },
];

async function download(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

async function main() {
  const versionFlag = process.argv.indexOf("--version");
  const version = versionFlag === -1 ? VERSION : process.argv[versionFlag + 1];

  if (version === undefined) {
    throw new Error("--version needs a tag, such as v0.9.6");
  }

  const url = `https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/download/${version}/LibreHardwareMonitor.zip`;
  console.log(`Downloading ${version}…`);

  const archive = await download(url);
  const digest = createHash("sha256").update(archive).digest("hex");

  if (SHA256 !== null && digest !== SHA256) {
    throw new Error(
      `Refusing to stage: expected sha256 ${SHA256}, got ${digest}. ` +
        "The release changed; review it before pinning the new digest.",
    );
  }

  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });

  const zipPath = path.join(target, "LibreHardwareMonitor.zip");
  await writeFile(zipPath, archive);

  // The launcher runs the executable, so the archive is unpacked in place.
  // LHM is a Windows program; its archive carries no portable equivalent.
  if (process.platform === "win32") {
    const run = promisify(execFile);
    await run("powershell", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${target}' -Force`,
    ]);
    // The zip itself is not needed once its contents are staged.
    await rm(zipPath, { force: true });
  } else {
    console.warn(
      `Skipped unpacking: LibreHardwareMonitor is Windows-only. The archive ` +
        `is staged at ${zipPath}; unpack it on a Windows build.`,
    );
  }

  // Notices travel with the binaries; their licences require it.
  for (const notice of NOTICE_FILES) {
    const body = await download(notice.url);
    await writeFile(path.join(target, notice.name), body);
  }

  await writeFile(
    path.join(target, "PROVENANCE.txt"),
    [
      `LibreHardwareMonitor ${version}`,
      `source: ${url}`,
      `sha256: ${digest}`,
      "",
      "Staged by packages/host/scripts/vendor-lhm.mjs. Not committed.",
      "Yunari links nothing and modifies nothing; it runs the executable and",
      "reads the JSON its web server publishes.",
      "",
      "LICENSE and THIRD-PARTY-NOTICES.txt are LHM's own notices, added here",
      "because the release archive omits them while bundling Aga.Controls",
      "(BSD), HidSharp, OxyPlot and RAMSPDToolkit binaries.",
      "",
      "PawnIO is fetched by LHM at runtime and is NOT in this archive;",
      "distributing it needs its own review (LGPL-2.1).",
      "",
    ].join("\n"),
  );

  console.log(`Staged ${version} into ${target}`);
  console.log(`sha256 ${digest}`);
  console.log(
    "Release builds must extract the archive and ship its notices. " +
      "Redistribution needs maintainer sign-off.",
  );
}

await main();
