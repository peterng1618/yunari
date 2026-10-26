import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
// The script lives at the repository root, four levels above this file:
// src/web/tests/scripts → ../../../.. = repo root.
import { verifyFfmpeg } from "../../../../scripts/verify-ffmpeg.mjs";

/**
 * The ffmpeg binary check's own proof: fixture binaries under `os.tmpdir()`,
 * one directory removed afterwards. The digests are computed here rather than
 * copied so a case states the rule it tests, and no fixture is in the real map.
 */

const VERSION = "5.3.0";
const directory = mkdtempSync(path.join(os.tmpdir(), "yunari-verify-ffmpeg-"));

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
  expect(existsSync(directory)).toBe(false);
});

function fixture(
  name: string,
  contents: string,
): { path: string; sha256: string } {
  const file = path.join(directory, name);
  writeFileSync(file, contents);
  return {
    path: file,
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
}

/** The map a real host would read, for `linux-x64` alone. */
function hashesFor(sha256: string): {
  version: string;
  sha256: Record<string, string>;
} {
  return { version: VERSION, sha256: { "linux-x64": sha256 } };
}

function verify(
  binaryPath: string,
  hashes: { version: string; sha256: Record<string, string> },
  version = VERSION,
) {
  return verifyFfmpeg({
    binaryPath,
    version,
    platform: "linux",
    arch: "x64",
    hashes,
  });
}

describe("verifyFfmpeg", () => {
  it("accepts bytes that match the recorded digest", () => {
    const binary = fixture("matching", "the real ffmpeg bytes");

    expect(verify(binary.path, hashesFor(binary.sha256))).toEqual({ ok: true });
  });

  it("refuses different bytes and names the expected and actual digest", () => {
    const binary = fixture("tampered", "some other bytes");
    const expected = hashesFor("0".repeat(64));

    const result = verify(binary.path, expected);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("0".repeat(64));
    expect(result.message).toContain(binary.sha256);
  });

  it("refuses a platform with no recorded entry", () => {
    const binary = fixture("unlisted", "bytes");

    const result = verifyFfmpeg({
      binaryPath: binary.path,
      version: VERSION,
      platform: "linux",
      arch: "arm64",
      hashes: hashesFor(binary.sha256),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("no recorded SHA-256");
    expect(result.message).toContain("linux-arm64");
  });

  it("refuses when the recorded map is for another version", () => {
    const binary = fixture("version", "bytes");

    const result = verify(binary.path, hashesFor(binary.sha256), "5.4.0");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("5.3.0");
    expect(result.message).toContain("5.4.0");
  });

  it("refuses a binary that is not there", () => {
    const missing = path.join(directory, "absent");

    const result = verify(missing, hashesFor("0".repeat(64)));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain(missing);
  });
});
