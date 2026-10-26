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
  /**
   * A 200-byte archive whose EOCD claims 2 entries and whose ZIP64 record is
   * real at 160 but truncated: the 56-byte extent runs past the buffer while
   * the count at +32 is still inside it. Extraction takes the count; a
   * preflight that demanded a whole record would skip it and see 2 instead.
   */
  const truncatedZip64Record = (): Uint8Array => {
    const bytes = new Uint8Array(200);
    const view = new DataView(bytes.buffer);
    view.setUint32(160, 0x0606_4b50, true);
    view.setUint32(192, 5000, true);
    view.setUint32(80, 0x0706_4b50, true);
    view.setUint32(88, 160, true);
    view.setUint32(100, 0x0605_4b50, true);
    view.setUint16(108, 2, true);
    view.setUint16(110, 2, true);
    return bytes;
  };

  /**
   * An EOCD at 65,559 bytes from the end — one byte past the old give-up
   * distance — with a non-matching dword at 65,558 and a valid locator/ZIP64
   * record. fflate still tests that far. The count is 5,000, never the 32-bit
   * maximum, so a red run that goes on to extract terminates.
   */
  const distantEndRecord = (): Uint8Array => {
    const bytes = new Uint8Array(65_559 + 200);
    const view = new DataView(bytes.buffer);
    view.setUint32(100, 0x0606_4b50, true);
    view.setUint32(132, 5000, true);
    view.setUint32(180, 0x0706_4b50, true);
    view.setUint32(188, 100, true);
    view.setUint32(200, 0x0605_4b50, true);
    view.setUint16(208, 2, true);
    view.setUint16(210, 2, true);
    return bytes;
  };

  it("reads an end record at 65,559 bytes from the end", () => {
    const bytes = distantEndRecord();

    expect(zipEntryCount(bytes)).toBe(5000);
    expect(zipCentralDirectoryBytes(bytes)).toBe(0);
  });

  it("reads the ZIP64 count out of a record truncated by the buffer's end", () => {
    const bytes = truncatedZip64Record();

    expect(zipEntryCount(bytes)).toBe(5000);
    expect(zipCentralDirectoryBytes(bytes)).toBe(0);
  });

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
