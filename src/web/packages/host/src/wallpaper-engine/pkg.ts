/**
 * The Wallpaper Engine package container, as both `scene.pkg` and the mobile
 * `.mpkg` export pack it:
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

export interface Package {
  /** Member offsets are relative to `dataStart`, as the format stores them. */
  readonly bytes: Uint8Array;
  readonly dataStart: number;
  readonly members: ReadonlyMap<string, PackageMember>;
}

/** `PKGV` is the desktop scene package, `PKGM` the mobile export; the table is
 *  the same and only the magic differs. `0001`, `0014`, `0020`, `0024` and
 *  `0025` all occur in shipped packages. */
const MAGIC = /^PKG[VM]\d{4}$/;

function readUInt32(view: DataView, at: number): number | undefined {
  if (at < 0 || at + 4 > view.byteLength) {
    return undefined;
  }

  return view.getUint32(at, true);
}

export function readPackage(bytes: Uint8Array): Package | undefined {
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
  pkg: Package,
  name: string,
): Uint8Array | undefined {
  const member = pkg.members.get(name);
  if (member === undefined) {
    return undefined;
  }

  const start = pkg.dataStart + member.offset;

  return pkg.bytes.subarray(start, start + member.length);
}

/** The one member a mobile export's video lives in. */
const MOBILE_VIDEO = "wallpaper.mp4";

/** The descriptor a mobile export carries beside its video. */
const MOBILE_PROJECT = "project.json";

/** What an import can take from a mobile package: the MP4, and whatever credit
 *  `project.json` can offer. A still-at-rest scene exports as a video too, so
 *  this is the only payload the route produces. */
export interface MobilePackage {
  readonly video: Uint8Array;
  readonly title?: string;
  readonly workshopId?: string;
}

/** The video and whatever credit `project.json` can offer, or `undefined` when
 *  the container is malformed or carries no video. A descriptor this code
 *  cannot parse costs the metadata, never the video. */
export function mobilePackage(bytes: Uint8Array): MobilePackage | undefined {
  const pkg = readPackage(bytes);
  if (pkg === undefined) {
    return undefined;
  }

  const video = memberBytes(pkg, MOBILE_VIDEO);
  if (video === undefined || video.length === 0) {
    return undefined;
  }

  const project = memberBytes(pkg, MOBILE_PROJECT);
  const metadata =
    project === undefined
      ? undefined
      : readProjectMetadata(new TextDecoder().decode(project));

  return {
    video,
    ...(metadata?.title === undefined ? {} : { title: metadata.title }),
    ...(metadata?.workshopId === undefined
      ? {}
      : { workshopId: metadata.workshopId }),
  };
}

/** The two credit fields a mobile export's descriptor may carry. The descriptor
 *  is third-party content: a number it cannot represent safely becomes no id
 *  rather than a rounded one. */
function readProjectMetadata(
  text: string,
): { readonly title?: string; readonly workshopId?: string } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }

  const project = parsed as {
    readonly title?: unknown;
    readonly package?: { readonly workshopId?: unknown };
  };
  const workshopId = project.package?.workshopId;

  return {
    ...(typeof project.title === "string" ? { title: project.title } : {}),
    ...(typeof workshopId === "string"
      ? { workshopId }
      : typeof workshopId === "number" && Number.isSafeInteger(workshopId)
        ? { workshopId: String(workshopId) }
        : {}),
  };
}
