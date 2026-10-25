/** An end-of-central-directory record is 22 bytes plus at most a 65,535-byte
 *  archive comment, which is all a backwards scan ever has to cover. */
const END_RECORD_SEARCH_BYTES = 65_557;

export const ZIP_MAX_ENTRIES = 128;
export const ZIP_MAX_CENTRAL_DIRECTORY_BYTES = 8 * 1024 * 1024;

export type ZipDeclaration = {
  readonly entries: number;
  readonly centralDirectoryBytes: number;
};

/**
 * Reads the entry count and central-directory size an archive declares, before
 * anything walks it: a crafted ZIP64 record can claim 4,294,967,295 entries
 * and `unzipSync` allocates per declared entry.
 *
 * The parse mirrors fflate's own end-record walk — the same backwards scan over
 * the tail, the same 16-bit EOCD count and 32-bit ZIP64 fields — so the number
 * refused here is the number extraction would use. A stricter parse would be a
 * bypass: a record it skipped could still steer the extractor.
 */
export function readZipDeclaration(
  bytes: Uint8Array,
): ZipDeclaration | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = bytes.byteLength - 22;
  for (; eocd >= 0; --eocd) {
    if (view.getUint32(eocd, true) === 0x0605_4b50) break;
    if (bytes.byteLength - eocd > END_RECORD_SEARCH_BYTES) return undefined;
  }
  if (eocd < 0) return undefined;
  // Extraction returns an empty archive for this, so there is nothing to bound.
  const entries = view.getUint16(eocd + 8, true);
  if (entries === 0) return { entries: 0, centralDirectoryBytes: 0 };
  let centralDirectoryBytes = view.getUint32(eocd + 12, true);
  // The ZIP64 locator sits immediately before the EOCD. fflate follows it and
  // reads the 32-bit low half of the 64-bit counts, so this does too.
  if (eocd >= 20 && view.getUint32(eocd - 20, true) === 0x0706_4b50) {
    const zip64 = view.getUint32(eocd - 12, true);
    if (
      zip64 + 56 <= bytes.byteLength &&
      view.getUint32(zip64, true) === 0x0606_4b50
    ) {
      return {
        entries: view.getUint32(zip64 + 32, true),
        centralDirectoryBytes: view.getUint32(zip64 + 40, true),
      };
    }
  }
  return { entries, centralDirectoryBytes };
}

export function zipEntryCount(bytes: Uint8Array): number | undefined {
  return readZipDeclaration(bytes)?.entries;
}

export function zipCentralDirectoryBytes(
  bytes: Uint8Array,
): number | undefined {
  return readZipDeclaration(bytes)?.centralDirectoryBytes;
}
