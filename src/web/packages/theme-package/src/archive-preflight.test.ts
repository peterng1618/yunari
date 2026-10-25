import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  readZipDeclaration,
  ZIP_MAX_CENTRAL_DIRECTORY_BYTES,
  ZIP_MAX_ENTRIES,
  zipCentralDirectoryBytes,
  zipEntryCount,
} from "./archive-preflight.js";

/**
 * A ZIP64 end record whose EOCD still holds the saturated 16-bit count, so the
 * huge declaration is only visible to a reader that follows the locator — the
 * record a plain EOCD scan would answer "65,535" for and extraction would read
 * as four billion.
 */
function zip64EndRecords(
  entries: number,
  centralDirectoryBytes: number,
): Uint8Array {
  const bytes = new Uint8Array(56 + 20 + 22);
  const view = new DataView(bytes.buffer);
  // ZIP64 end of central directory, at the start of these bytes.
  view.setUint32(0, 0x0606_4b50, true);
  view.setBigUint64(4, 44n, true);
  view.setUint16(12, 45, true);
  view.setUint16(14, 45, true);
  view.setBigUint64(24, BigInt(entries), true);
  view.setBigUint64(32, BigInt(entries), true);
  view.setBigUint64(40, BigInt(centralDirectoryBytes), true);
  // Its locator, as extraction expects to find it: immediately before the EOCD.
  view.setUint32(56, 0x0706_4b50, true);
  view.setBigUint64(64, 0n, true);
  view.setUint32(72, 1, true);
  // The 16-bit EOCD, with both count fields saturated.
  view.setUint32(76, 0x0605_4b50, true);
  view.setUint16(84, 0xffff, true);
  view.setUint16(86, 0xffff, true);
  view.setUint32(88, centralDirectoryBytes, true);
  return bytes;
}

describe("archive preflight", () => {
  it("reads the declaration of an ordinary archive", () => {
    const bytes = zipSync({
      "one.json": strToU8("{}"),
      "two.json": strToU8("{}"),
    });

    expect(zipEntryCount(bytes)).toBe(2);
    expect(zipCentralDirectoryBytes(bytes)).toBeGreaterThan(0);
  });

  it("follows the ZIP64 record instead of the saturated EOCD count", () => {
    const bytes = zip64EndRecords(0xffff_ffff, 1024);

    expect(zipEntryCount(bytes)).toBe(0xffff_ffff);
    expect(ZIP_MAX_ENTRIES).toBe(128);
  });

  it("reads a central directory larger than the bound from the ZIP64 record", () => {
    const declared = ZIP_MAX_CENTRAL_DIRECTORY_BYTES + 1;

    expect(zipCentralDirectoryBytes(zip64EndRecords(2, declared))).toBe(
      declared,
    );
  });

  it("answers nothing when the bytes hold no end record", () => {
    expect(readZipDeclaration(new Uint8Array())).toBeUndefined();
    expect(zipEntryCount(new Uint8Array(64).fill(0x41))).toBeUndefined();
  });
});
