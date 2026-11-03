import fs from "node:fs/promises";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { relativeLuminanceOf } from "@yunari/renderer-core";
import { readContainedFile } from "./contained-read.js";
import { isValidThemeId, THUMBNAIL_FILE } from "./store.js";

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

/** Longest edge a host-side capture renders. The editor caps its own canvas
 *  capture at the same size, so a picture looks the same whichever save
 *  produced it. */
const CAPTURE_MAX_EDGE = 640;

/**
 * The size a host-side capture asks the player for: the artboard's aspect, its
 * long edge capped, and a square for a circle because the disc is inscribed in
 * it. The player letterboxes the artboard into the page, so a rect theme fills
 * the picture and a circle theme shows its disc.
 */
export function thumbnailCaptureSize(artboard: {
  readonly width: number;
  readonly height: number;
  readonly shape?: "rect" | "circle" | undefined;
}): { readonly width: number; readonly height: number } {
  const long = Math.max(artboard.width, artboard.height);
  if (artboard.shape === "circle") {
    const side = Math.max(1, Math.round(Math.min(CAPTURE_MAX_EDGE, long)));
    return { width: side, height: side };
  }
  const scale = long > 0 ? Math.min(CAPTURE_MAX_EDGE, long) / long : 1;
  return {
    width: Math.max(1, Math.round(artboard.width * scale)),
    height: Math.max(1, Math.round(artboard.height * scale)),
  };
}

export interface ThumbnailStore {
  read(id: string): Promise<Uint8Array | undefined>;
  /** Whether a picture is stored at all, without reading its bytes: a listing
   *  asks this so its page requests only images that exist (`vg-655`). */
  has(id: string): Promise<boolean>;
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

/** Channels per pixel, keyed by the PNG colour type. Palette images (type 3)
 *  are absent: no capture writes one, and decoding the palette would add a
 *  table this reader never meets. */
const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** One reconstructed scanline's filter, applied to the bytes already read. */
function unfilter(
  method: number,
  row: Uint8Array,
  previous: Uint8Array,
  bytesPerPixel: number,
): boolean {
  for (let index = 0; index < row.length; index += 1) {
    const left = index < bytesPerPixel ? 0 : row[index - bytesPerPixel]!;
    const up = previous[index]!;
    const upLeft = index < bytesPerPixel ? 0 : previous[index - bytesPerPixel]!;
    switch (method) {
      case 0:
        break;
      case 1:
        row[index] = (row[index]! + left) & 0xff;
        break;
      case 2:
        row[index] = (row[index]! + up) & 0xff;
        break;
      case 3:
        row[index] = (row[index]! + ((left + up) >> 1)) & 0xff;
        break;
      case 4: {
        const estimate = left + up - upLeft;
        const toLeft = Math.abs(estimate - left);
        const toUp = Math.abs(estimate - up);
        const toUpLeft = Math.abs(estimate - upLeft);
        const nearest =
          toLeft <= toUp && toLeft <= toUpLeft
            ? left
            : toUp <= toUpLeft
              ? up
              : upLeft;
        row[index] = (row[index]! + nearest) & 0xff;
        break;
      }
      default:
        return false;
    }
  }
  return true;
}

/**
 * The mean WCAG relative luminance of a stored thumbnail, or `undefined` for a
 * PNG this reader cannot decode.
 *
 * The colour-mode facet classifies a theme by what a viewer sees, and once
 * media is behind the board that is the picture rather than the paint token.
 * The picture is the host's own capture, always 8-bit and non-interlaced, so
 * this decodes exactly that shape with `node:zlib` and refuses the rest rather
 * than growing an image library for a case the capture cannot produce.
 *
 * **Transparency is ignored**: a captured dashboard is opaque, and a
 * transparent pixel has no colour of its own to average.
 *
 * ponytail: one full decode per listing entry. Cache the mean beside the
 * picture's mtime if library listings grow large enough for it to show.
 */
export function thumbnailLuminance(bytes: Uint8Array): number | undefined {
  const dimensions = pngDimensions(bytes);
  if (dimensions === undefined) return undefined;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const compressed: Uint8Array[] = [];
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colourType = -1;
  let compression = 0;
  let filterMethod = 0;
  let interlace = 0;

  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= bytes.byteLength) {
    const length = view.getUint32(offset);
    if (length > bytes.byteLength - offset - 12) return undefined;
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    );
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      if (length < 13) return undefined;
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      bitDepth = bytes[offset + 16]!;
      colourType = bytes[offset + 17]!;
      compression = bytes[offset + 18]!;
      filterMethod = bytes[offset + 19]!;
      interlace = bytes[offset + 20]!;
    } else if (type === "IDAT") {
      compressed.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }

  const channels = CHANNELS[colourType];
  if (
    channels === undefined ||
    bitDepth !== 8 ||
    compression !== 0 ||
    filterMethod !== 0 ||
    interlace !== 0 ||
    width === 0 ||
    height === 0 ||
    width * height > MAX_THUMBNAIL_PIXELS
  ) {
    return undefined;
  }

  let raw: Uint8Array;
  try {
    raw = new Uint8Array(inflateSync(Buffer.concat(compressed)));
  } catch {
    return undefined;
  }

  const stride = width * channels;
  if (raw.byteLength < (stride + 1) * height) return undefined;

  const row = new Uint8Array(stride);
  const previous = new Uint8Array(stride);
  let source = 0;
  let total = 0;

  for (let line = 0; line < height; line += 1) {
    const method = raw[source]!;
    source += 1;
    row.set(raw.subarray(source, source + stride));
    source += stride;
    if (!unfilter(method, row, previous, channels)) return undefined;

    for (let pixel = 0; pixel < stride; pixel += channels) {
      const red = row[pixel]!;
      // Greyscale has one channel, and its alpha-bearing form has the same
      // colour in the first slot; both describe a grey pixel.
      const green = channels <= 2 ? red : row[pixel + 1]!;
      const blue = channels <= 2 ? red : row[pixel + 2]!;
      total += relativeLuminanceOf(red, green, blue);
    }
    previous.set(row);
  }

  return total / (width * height);
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
  const filePath = (id: string): string =>
    path.join(library, id, THUMBNAIL_FILE);

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
        `${id}/${THUMBNAIL_FILE}`,
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

    async has(id) {
      if (!isValidThemeId(id)) {
        return false;
      }

      // A stat rather than `read`: the listing shows a row per theme, and
      // reading every picture to decide whether to draw one is the cost this
      // exists to avoid. A file only the reader would refuse still costs its
      // one 404, which is the honest answer for a corrupt picture.
      try {
        await fs.stat(filePath(id));
        return true;
      } catch {
        return false;
      }
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
