/** fflate gives up only when a *non-matching* offset is more than this far from
 *  the end: it still tests the signature one byte past it, at 65,559. A
 *  tighter window would skip an end record that extraction accepts. */
const END_RECORD_MAX_DISTANCE = 65_558;

export const ZIP_MAX_ENTRIES = 128;
export const ZIP_MAX_CENTRAL_DIRECTORY_BYTES = 8 * 1024 * 1024;

export type ZipDeclaration = {
  readonly entries: number;
  readonly centralDirectoryBytes: number;
};

/**
 * Four little-endian bytes as fflate's `b4` reads them: a byte past either end
 * is 0. A truncated record is still a record extraction will use, so refusing
 * the same fields with a bounds guard would let the two readers disagree.
 */
function readUint32(bytes: Uint8Array, offset: number): number {
  let value = 0;
  for (let index = 0; index < 4; index += 1) {
    const byte = bytes[offset + index];
    if (byte !== undefined) value |= byte << (8 * index);
  }
  return value >>> 0;
}

/**
 * Reads the entry count and central-directory size an archive declares, before
 * anything walks it: a crafted ZIP64 record can claim 4,294,967,295 entries
 * and `unzipSync` allocates per declared entry.
 *
 * The parse mirrors fflate's own end-record walk — the same backwards scan (a
 * match is accepted at 65,559 bytes from the end, a non-matching offset past
 * 65,558 ends it), the same 16-bit EOCD count, the same 32-bit ZIP64 fields
 * with out-of-range bytes read as zero — so the count refused here is the count
 * extraction would use. The central-directory size is not something extraction
 * reads: the 8 MiB bound below is this module's own.
 */
export function readZipDeclaration(
  bytes: Uint8Array,
): ZipDeclaration | undefined {
  let eocd = bytes.byteLength - 22;
  for (; eocd >= 0; --eocd) {
    if (readUint32(bytes, eocd) === 0x0605_4b50) break;
    if (bytes.byteLength - eocd > END_RECORD_MAX_DISTANCE) return undefined;
  }
  if (eocd < 0) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = view.getUint16(eocd + 8, true);
  // Extraction returns an empty archive for this, so there is nothing to bound.
  if (entries === 0) return { entries: 0, centralDirectoryBytes: 0 };
  // The ZIP64 locator sits immediately before the EOCD. fflate follows it on
  // the signatures alone, never on the record being complete, and reads the
  // 32-bit low half of the 64-bit count; this does too. Once both signatures
  // match the 16-bit count is not a fallback.
  if (readUint32(bytes, eocd - 20) === 0x0706_4b50) {
    const zip64 = readUint32(bytes, eocd - 12);
    if (readUint32(bytes, zip64) === 0x0606_4b50)
      return {
        entries: readUint32(bytes, zip64 + 32),
        centralDirectoryBytes: readUint32(bytes, zip64 + 40),
      };
  }
  return { entries, centralDirectoryBytes: readUint32(bytes, eocd + 12) };
}

export function zipEntryCount(bytes: Uint8Array): number | undefined {
  return readZipDeclaration(bytes)?.entries;
}

export function zipCentralDirectoryBytes(
  bytes: Uint8Array,
): number | undefined {
  return readZipDeclaration(bytes)?.centralDirectoryBytes;
}
