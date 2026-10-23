/**
 * The `scene.pkg` container, as Wallpaper Engine packs it:
 *
 *   u32 magicLen  "PKGV0001"  u32 entryCount
 *   per entry: u32 nameLen  name[nameLen]  u32 dataOffset  u32 dataLen
 *   then the member bytes, contiguous, offsets relative to the table's end.
 *
 * A malformed package is normal input here — a library on disk holds files this
 * code did not write — so every field is bounds-checked and a bad table yields
 * `undefined` rather than a partial one.
 */

export interface PackageMember {
  readonly name: string;
  readonly offset: number;
  readonly length: number;
}

export interface ScenePackage {
  /** Member offsets are relative to `dataStart`, as the format stores them. */
  readonly bytes: Uint8Array;
  readonly dataStart: number;
  readonly members: ReadonlyMap<string, PackageMember>;
}

/** `0001`, `0020`, `0024` and `0025` all occur in shipped packages. */
const MAGIC = /^PKGV\d{4}$/;

function readUInt32(view: DataView, at: number): number | undefined {
  if (at < 0 || at + 4 > view.byteLength) {
    return undefined;
  }

  return view.getUint32(at, true);
}

export function readScenePackage(bytes: Uint8Array): ScenePackage | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const magicLength = readUInt32(view, 0);
  if (
    magicLength === undefined ||
    magicLength === 0 ||
    4 + magicLength > view.byteLength
  ) {
    return undefined;
  }

  const magic = new TextDecoder().decode(bytes.subarray(4, 4 + magicLength));
  if (!MAGIC.test(magic)) {
    return undefined;
  }

  const entryCount = readUInt32(view, 4 + magicLength);
  if (entryCount === undefined) {
    return undefined;
  }

  const members = new Map<string, PackageMember>();
  let cursor = 8 + magicLength;

  for (let index = 0; index < entryCount; index += 1) {
    const nameLength = readUInt32(view, cursor);
    if (nameLength === undefined || nameLength === 0) {
      return undefined;
    }
    cursor += 4;

    if (cursor + nameLength > view.byteLength) {
      return undefined;
    }
    const name = new TextDecoder().decode(
      bytes.subarray(cursor, cursor + nameLength),
    );
    cursor += nameLength;

    const offset = readUInt32(view, cursor);
    const length = readUInt32(view, cursor + 4);
    if (offset === undefined || length === undefined) {
      return undefined;
    }
    cursor += 8;

    if (members.has(name)) {
      return undefined;
    }

    members.set(name, { name, offset, length });
  }

  const dataStart = cursor;
  for (const member of members.values()) {
    // Offsets are relative to the table's end, so a healthy table cannot point
    // outside the file.
    if (dataStart + member.offset + member.length > bytes.byteLength) {
      return undefined;
    }
  }

  return { bytes, dataStart, members };
}

export function memberBytes(
  pkg: ScenePackage,
  name: string,
): Uint8Array | undefined {
  const member = pkg.members.get(name);
  if (member === undefined) {
    return undefined;
  }

  const start = pkg.dataStart + member.offset;

  return pkg.bytes.subarray(start, start + member.length);
}
