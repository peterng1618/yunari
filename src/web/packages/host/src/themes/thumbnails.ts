import fs from "node:fs/promises";
import path from "node:path";
import { readContainedFile } from "./contained-read.js";
import { isValidThemeId } from "./store.js";

/**
 * A still of a theme's artboard, stored inside that theme's own folder so the
 * library can show a picture instead of a name.
 *
 * It also travels in the exported package, in a slot `theme-package` names in
 * the manifest and rewrites on every export. The ruling that put it there
 * overturned the earlier argument against it — that a picture is a rendering of
 * one machine's fonts and GPU, and so not portable. The half that still holds:
 * a thumbnail is not a *runtime* asset, which is why it is a slot of its own
 * rather than something in `assets/` for the renderer to load. Losing one is
 * never an error; the library falls back to text.
 */

const FILE = "thumbnail.png";
/** A screenshot of a dashboard; anything larger is not one. */
const MAX_BYTES = 2 * 1024 * 1024;

/** The largest declared size the library will hand a browser. A picture is
 *  drawn at gallery-cell size, so both bounds are far above anything a capture
 *  produces; what they refuse is a header claiming a surface a decoder would
 *  then try to allocate. The pixel cap is implied by the edge cap (4096² is
 *  exactly 16 777 216) while the edge stays at 4096; both are stated because
 *  the bound is about a surface and each unit is one an author can picture. */
export const MAX_THUMBNAIL_EDGE = 4096;
export const MAX_THUMBNAIL_PIXELS = 16_777_216;

/** PNG magic: the only format the library renders. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface ThumbnailStore {
  read(id: string): Promise<Uint8Array | undefined>;
  write(id: string, bytes: Uint8Array): Promise<void>;
  remove(id: string): Promise<void>;
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength > PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
  );
}

/**
 * The pixel size the PNG's header declares, or `undefined` when the bytes carry
 * no readable one.
 *
 * The header is the only place the size is known before decoding, and decoding
 * is what a bound exists to refuse: a crafted IHDR can claim a surface far
 * larger than the file. Offsets are fixed by the format — signature (8), the
 * IHDR chunk's length (4) and type (4), then width and height — and the CRC is
 * not checked here because the browser's decoder is the one that has to accept
 * the image; this only decides whether to hand it over.
 */
export function pngDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | undefined {
  if (!isPng(bytes) || bytes.byteLength < 24) {
    return undefined;
  }
  // "IHDR" at the first chunk.
  if (
    bytes[12] !== 0x49 ||
    bytes[13] !== 0x48 ||
    bytes[14] !== 0x44 ||
    bytes[15] !== 0x52
  ) {
    return undefined;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Why a picture's declared size is past what the library will render, or
 *  `undefined` when it is not. */
function pixelRefusal(bytes: Uint8Array): string | undefined {
  const size = pngDimensions(bytes);
  if (size === undefined) {
    return "A thumbnail must be a PNG with a readable header.";
  }
  const { width, height } = size;
  if (width === 0 || height === 0) {
    return "A thumbnail must declare a pixel size.";
  }
  // The edge bound is checked first, so the product below is at most 4096² and
  // cannot lose precision the way a uint32 pair multiplied raw would.
  if (
    width > MAX_THUMBNAIL_EDGE ||
    height > MAX_THUMBNAIL_EDGE ||
    width * height > MAX_THUMBNAIL_PIXELS
  ) {
    return (
      `That thumbnail declares ${width}×${height}; a thumbnail may be at ` +
      `most ${MAX_THUMBNAIL_EDGE} pixels on a side.`
    );
  }
  return undefined;
}

/** A name a theme folder's own listing cannot mistake for anything, matching
 *  the theme store's staging names. */
function scratchName(): string {
  return `.thumbnail-${Date.now()}.${Math.random().toString(36).slice(2)}`;
}

/**
 * @param library The theme library's root: a picture belongs to the theme it
 *   renders, so it is addressed through the same directory the theme is.
 */
export function createThumbnailStore(library: string): ThumbnailStore {
  const filePath = (id: string): string => path.join(library, id, FILE);

  return {
    async read(id) {
      if (!isValidThemeId(id)) {
        return undefined;
      }

      // Contained, like every other file this host reads out of a theme
      // folder: a picture linked in from outside is not this theme's. Absent is
      // ordinary — an older package, or a capture that failed — and the helper
      // answers `undefined` for it rather than throwing. The write bound is the
      // read bound too, refused before the file is buffered.
      const bytes = await readContainedFile(
        library,
        `${id}/${FILE}`,
        MAX_BYTES,
      );

      // A file someone else wrote must not be served as an image — nor one
      // whose header declares a surface the library will not draw.
      return bytes !== undefined &&
        isPng(bytes) &&
        pixelRefusal(bytes) === undefined
        ? new Uint8Array(bytes)
        : undefined;
    },

    async write(id, bytes) {
      if (!isValidThemeId(id)) {
        throw new Error("Invalid theme id.");
      }

      if (bytes.byteLength > MAX_BYTES) {
        throw new Error("That thumbnail is too large.");
      }

      if (!isPng(bytes)) {
        throw new Error("A thumbnail must be a PNG.");
      }

      // A picture the library would refuse to serve is not stored in the first
      // place, so a capture that produced one leaves the previous picture
      // readable instead of replacing it with a file nothing will draw.
      const tooLarge = pixelRefusal(bytes);
      if (tooLarge !== undefined) {
        throw new Error(tooLarge);
      }

      // Staged beside its target and renamed, the way the theme store writes a
      // folder: a picture now lives inside the folder that store protects, and a
      // torn one would be served as a corrupt image. `rename` onto an existing
      // *file* succeeds on Windows, unlike onto a directory.
      const folder = path.dirname(filePath(id));
      const staging = path.join(folder, scratchName());
      await fs.mkdir(folder, { recursive: true });

      try {
        await fs.writeFile(staging, bytes);
        await fs.rename(staging, filePath(id));
      } catch (error) {
        await fs.rm(staging, { force: true });
        throw error;
      }
    },

    async remove(id) {
      if (!isValidThemeId(id)) {
        return;
      }

      // The picture, never the theme: a theme is removed by removing its folder,
      // and the picture goes with it because it is one file in there. This
      // exists to drop a picture on its own, and the folder is the theme store's.
      await fs.rm(filePath(id), { force: true });
    },
  };
}
