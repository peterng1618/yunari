import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

/**
 * Stages the `systray2` Linux tray binary into `packages/host/vendor/tray` so a
 * release can ship it. The executable is never committed: it is third-party
 * binary output, and the repository tracks its provenance instead.
 *
 * Run: `node packages/host/scripts/vendor-tray.mjs`
 */

const VERSION = "2.1.4";
const URL = `https://registry.npmjs.org/systray2/-/systray2-${VERSION}.tgz`;
/** Pinned so the staged bytes are reproducible and auditable. */
const SHA256 = "24a176933952c4db79026dcec25c7acf48e5c1cee5d94bc6b87740060bc8ed00";

/** Only these travel; the archive's macOS/Windows binaries are not staged. */
const BINARY_MEMBER = "package/traybin/tray_linux_release";
const LICENSE_MEMBER = "package/LICENSE";

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, "..", "vendor", "tray");

async function main() {
  console.log(`Downloading systray2 ${VERSION}…`);

  const response = await fetch(URL);
  if (!response.ok) {
    throw new Error(`${URL} answered ${response.status}`);
  }
  const archive = new Uint8Array(await response.arrayBuffer());
  const digest = createHash("sha256").update(archive).digest("hex");

  // Verify before anything is unpacked, so a tampered tarball writes nothing
  // into the repository — not even into the vendor directory.
  if (digest !== SHA256) {
    throw new Error(
      `Refusing to stage: expected sha256 ${SHA256}, got ${digest}. ` +
        "The release changed; review it before pinning the new digest.",
    );
  }

  const temp = await mkdtemp(path.join(os.tmpdir(), "yunari-tray-"));
  try {
    const archivePath = path.join(temp, "systray2.tgz");
    const extractDir = path.join(temp, "extract");
    await writeFile(archivePath, archive);
    await mkdir(extractDir, { recursive: true });
    // Relative paths with a cwd: GNU tar reads a Windows drive letter in an
    // argument as a remote host, which fails on `C:\…`.
    await run(
      "tar",
      [
        "-xzf",
        "systray2.tgz",
        "-C",
        "extract",
        BINARY_MEMBER,
        LICENSE_MEMBER,
      ],
      { cwd: temp },
    );

    await rm(target, { recursive: true, force: true });
    await mkdir(target, { recursive: true });
    await copyFile(
      path.join(extractDir, BINARY_MEMBER),
      path.join(target, "tray_linux_release"),
    );
    await copyFile(
      path.join(extractDir, LICENSE_MEMBER),
      path.join(target, "LICENSE"),
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }

  await writeFile(
    path.join(target, "PROVENANCE.txt"),
    [
      `systray2 ${VERSION}`,
      `source: ${URL}`,
      `sha256: ${digest}`,
      `members: ${BINARY_MEMBER}, ${LICENSE_MEMBER}`,
      "",
      "Staged by packages/host/scripts/vendor-tray.mjs. Not committed.",
      "Yunari does not import the systray2 package; it runs the x86-64 Linux",
      "binary directly over JSON lines. LICENSE is systray2's own MIT notice.",
      "",
    ].join("\n"),
  );

  console.log(`Staged systray2 ${VERSION} into ${target}`);
  console.log(`sha256 ${digest}`);
  console.log("Release packaging must ship vendor/tray/LICENSE with the binary.");
}

await main();
