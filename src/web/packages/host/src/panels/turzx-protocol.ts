/**
 * The TURZX 5" panel's wire format: every write padded to a 250-byte multiple,
 * pixels sent as BGRA in 249-byte chunks, and a text HELLO that names the
 * panel.
 *
 * Pure, so the verified probe bytes are testable without hardware. Nothing here
 * opens a port; the adapter owns the transport.
 */

/** The frame size every write is padded to; a shorter command is ignored. */
export const FRAME_SIZE = 250;
/** A 249-byte chunk plus its `0x00` join is exactly one frame. */
const PAYLOAD_CHUNK = 249;

/** Native landscape; the panel is never rotated. */
export const TURZX_GEOMETRY = { width: 800, height: 480 } as const;

export interface TurzxIdentity {
  readonly model: string;
  readonly device: string;
  readonly firmware: string;
}

/** The panel's HELLO answer, after trailing NULs and whitespace are trimmed. */
const HELLO = /^chs_([a-z0-9_]+)\.(dev\d+)_rom([0-9.]+)$/;

/**
 * `bytes` padded to a 250-byte multiple.
 *
 * `START_DISPLAY_BITMAP` is the one frame padded with `0x2c`; every other write
 * pads with zero. A command that is already a multiple of 250 is unchanged, so
 * the bitmap start is a pass-through.
 */
export function frame(
  bytes: Uint8Array,
  padding: "null" | "bitmap" = "null",
): Uint8Array {
  const padded = new Uint8Array(
    Math.ceil(bytes.length / FRAME_SIZE) * FRAME_SIZE,
  );

  if (padding === "bitmap") padded.fill(0x2c);
  padded.set(bytes);
  return padded;
}

/** The identity a HELLO reply carries, or `undefined` for any other answer. */
export function parseHello(reply: Uint8Array): TurzxIdentity | undefined {
  return parseHelloText(
    new TextDecoder("latin1").decode(reply).replace(/[\0\s]+$/, ""),
  );
}

/** The identity an already-decoded HELLO answer carries, or `undefined`. */
export function parseHelloText(text: string): TurzxIdentity | undefined {
  const match = HELLO.exec(text);

  if (match === null) return undefined;

  const [, model, device, firmware] = match;
  if (model === undefined || device === undefined || firmware === undefined) {
    return undefined;
  }

  return { model: `chs_${model}`, device, firmware };
}

/**
 * Straight RGBA as the panel's payload: each pixel reordered to BGRA, chunked
 * at 249 bytes with one `0x00` between chunks, then padded to a 250 multiple.
 *
 * The chunked form is the wire's, not a convenience: a full 800x480 frame is
 * 1,542,250 bytes, which is exactly this join plus the final padding.
 */
export function bgraPayload(rgba: Uint8Array): Uint8Array {
  const bgra = new Uint8Array(rgba.length);

  for (let i = 0; i + 3 < bgra.length; i += 4) {
    const r = rgba[i] ?? 0;
    const g = rgba[i + 1] ?? 0;
    const b = rgba[i + 2] ?? 0;
    const a = rgba[i + 3] ?? 0;

    bgra[i] = b;
    bgra[i + 1] = g;
    bgra[i + 2] = r;
    bgra[i + 3] = a;
  }

  // One separator between chunks; the last chunk needs none, because the
  // padding that follows it already reaches the next frame boundary.
  return frame(joinChunks(bgra, PAYLOAD_CHUNK));
}

/** `bytes` split at `size`, with one `0x00` between each pair of chunks. */
function joinChunks(bytes: Uint8Array, size: number): Uint8Array {
  const chunks = Math.ceil(bytes.length / size);
  const joined = new Uint8Array(bytes.length + Math.max(0, chunks - 1));
  let offset = 0;

  for (let start = 0; start < bytes.length; start += size) {
    if (start > 0) {
      joined[offset] = 0x00;
      offset += 1;
    }

    const end = Math.min(start + size, bytes.length);
    joined.set(bytes.subarray(start, end), offset);
    offset += end - start;
  }

  return joined;
}

/**
 * The verified command table.
 *
 * `startBitmap` is already the full padded frame, so `frame` passes it through.
 * `brightness` is a prefix because the level byte is the caller's.
 */
export const TURZX_COMMAND = {
  hello: Uint8Array.of(
    0x01,
    0xef,
    0x69,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    0x00,
    0x00,
    0xc5,
    0xd3,
  ),
  stopVideo: Uint8Array.of(0x79, 0xef, 0x69, 0x00, 0x00, 0x00, 0x01),
  stopMedia: Uint8Array.of(0x96, 0xef, 0x69, 0x00, 0x00, 0x00, 0x01),
  brightness: Uint8Array.of(
    0x7b,
    0xef,
    0x69,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    0x00,
    0x00,
  ),
  screenOff: Uint8Array.of(0x83, 0xef, 0x69, 0x00, 0x00, 0x00, 0x01),
  screenOn: Uint8Array.of(0x83, 0xef, 0x69, 0x00, 0x00, 0x00, 0x00),
  restart: Uint8Array.of(0x84, 0xef, 0x69, 0x00, 0x00, 0x00, 0x01),
  preUpdate: Uint8Array.of(0x86, 0xef, 0x69, 0x00, 0x00, 0x00, 0x01),
  startBitmap: new Uint8Array(FRAME_SIZE).fill(0x2c),
  // The six-byte constant plus the reference's big-endian width^2/64 field
  // (480 * 480 / 64 = 3600): a zero field is a full-image send the panel drops.
  displayBitmap: Uint8Array.of(0xc8, 0xef, 0x69, 0x00, 0x17, 0x70, 0x0e, 0x10),
  displayOnVideo: Uint8Array.of(0xca, 0xef, 0x69, 0x00, 0x17, 0x70),
  queryStatus: Uint8Array.of(0xcf, 0xef, 0x69, 0x00, 0x00, 0x00, 0x01),
  startVideo: Uint8Array.of(0x78, 0xef, 0x69, 0x00, 0x00, 0x00),
  /** INIT_VIDEO_OVERLAY with its start-mode payload: `02` draws the overlay. */
  initVideoOverlay: Uint8Array.of(0xd0, 0xef, 0x69, 0x00, 0x00, 0x00, 0x02),
  /** The raw trailer every overlay payload closes with. */
  overlayTerminate: Uint8Array.of(0xef, 0x69),
  /** UPDATE_BITMAP's prefix; the encoder appends the size, count and visible fields. */
  updateBitmap: Uint8Array.of(0xcc, 0xef, 0x69, 0x00),
  uploadFile: Uint8Array.of(0x6f, 0xef, 0x69, 0x00, 0x00, 0x00),
  getFileSize: Uint8Array.of(0x6e, 0xef, 0x69, 0x00, 0x00, 0x00),
  deleteFile: Uint8Array.of(0x66, 0xef, 0x69, 0x00, 0x00, 0x00),
} as const;

/**
 * The seven-byte form an update's trailer takes when the padded payload ends
 * flush: the panel's own re-clear marker, then the ordinary terminator.
 */
const ALIGNED_TRAILER = Uint8Array.of(
  0x00,
  0x00,
  0x00,
  0x01,
  0x00,
  0x00,
  0xef,
  0x69,
);

/** A visible span of one row, as the reference's segment walk finds it. */
interface OverlaySegment {
  /** Pixel index, `y * width + x`. */
  readonly offset: number;
  readonly width: number;
  /** Byte index of the span's first pixel in an RGBA frame. */
  readonly at: number;
}

/** One overlay update, ready to frame. */
export interface OverlayUpdate {
  /** The value the header's imageSize field carries. */
  readonly imageSize: number;
  /** The value the header's visiblePixels field carries. */
  readonly visibleBytes: number;
  /** The unframed payload, including its alignment trailer. */
  readonly body: Uint8Array;
}

/**
 * The trailer an unframed payload of `unframedLength` bytes closes with, and
 * the aligned form's addition to `imageSize`.
 *
 * The device re-clears a region whose padded tail ends flush, so a body with
 * no room left after the two-byte terminator carries the wider form instead.
 * 250 itself is not "flush": the payload below the frame size is the plain one.
 * The aligned `extra` is 7 — the number the reference adds to `imageSize` —
 * even though the trailer it appends is eight bytes long.
 */
export function overlayTrailer(unframedLength: number): {
  readonly bytes: Uint8Array;
  readonly extra: number;
} {
  const remainder = unframedLength % FRAME_SIZE;

  if (
    unframedLength > FRAME_SIZE &&
    (remainder === 0 ||
      remainder === FRAME_SIZE - 2 ||
      remainder === FRAME_SIZE - 1)
  ) {
    return { bytes: Uint8Array.from(ALIGNED_TRAILER), extra: 7 };
  }

  return { bytes: Uint8Array.from(TURZX_COMMAND.overlayTerminate), extra: 0 };
}

/** `value` as three big-endian bytes at `at`; a DataView has no 24-bit setter. */
function writeUint24(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = (value >>> 16) & 0xff;
  bytes[at + 1] = (value >>> 8) & 0xff;
  bytes[at + 2] = value & 0xff;
}

/**
 * The 18-byte UPDATE_BITMAP header, unframed: the command prefix, the body's
 * image size (3 bytes BE), three zero bytes, the update count and the visible
 * list's size (4 bytes BE each).
 */
export function overlayHeader(
  imageSize: number,
  count: number,
  visibleBytes: number,
): Uint8Array {
  const header = new Uint8Array(18);
  header.set(TURZX_COMMAND.updateBitmap);
  writeUint24(header, 4, imageSize);
  const view = new DataView(header.buffer);
  view.setUint32(10, count);
  view.setUint32(14, visibleBytes);

  return header;
}

/** Whether the four RGBA bytes at `at` differ between the two frames. */
function changedAt(
  previous: Uint8Array,
  current: Uint8Array,
  at: number,
): boolean {
  return (
    previous[at] !== current[at] ||
    previous[at + 1] !== current[at + 1] ||
    previous[at + 2] !== current[at + 2] ||
    previous[at + 3] !== current[at + 3]
  );
}

/**
 * The reference's `_get_visible_segments_numba` walk, literally: a span starts
 * where `alpha > 0` and keeps extending while the next pixel is opaque **or the
 * pixel after it is**, so a one-pixel gap inside a run is kept.
 */
function segmentsInRow(
  width: number,
  alpha: (x: number) => number,
): readonly { readonly x: number; readonly width: number }[] {
  const segments: { readonly x: number; readonly width: number }[] = [];
  let i = 0;

  while (i < width) {
    if (alpha(i) > 0) {
      const x = i;
      let j = i + 1;
      while (
        j < width &&
        (alpha(j) > 0 || (j + 1 < width && alpha(j + 1) > 0))
      ) {
        j += 1;
      }
      segments.push({ x, width: j - x });
      i = j;
    }
    i += 1;
  }

  return segments;
}

/**
 * 4x4 Bayer thresholds. The overlay stores 4 bits per channel, so a smooth
 * gradient is 16 flat bands on the panel (observed 2026-10-29, static glass
 * over a video); a fraction of one step before rounding trades the band edge
 * for a fixed texture that reads as the tone between them. Solid black and
 * white stay exact, and the changed-pixel test runs before this, so no extra
 * bytes reach the wire.
 */
const DITHER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** One 4-bit channel value, dithered by the pixel's position. */
function dither(value: number, x: number, y: number): number {
  const threshold = DITHER_4[((y & 3) << 2) | (x & 3)] ?? 0;
  return Math.max(
    0,
    Math.min(15, Math.round((value / 255) * 15 + threshold / 16 - 0.5)),
  );
}

/**
 * The per-frame UPDATE_BITMAP payload: the pixels that changed since
 * `previous`, then the spans that are visible at all.
 *
 * A cleared pixel is not re-sent — it leaves the changed list and its absence
 * from the visible list is what the device erases. Segments, pixel packing and
 * the alignment trailer are the probe's, ported byte for byte.
 */
export function overlayUpdate(
  previous: Uint8Array,
  current: Uint8Array,
  geometry: { readonly width: number; readonly height: number },
): OverlayUpdate {
  const { width, height } = geometry;
  const expected = width * height * 4;

  if (previous.length !== expected) {
    throw new Error(
      `The previous overlay is ${previous.length} bytes; a ${width}x${height} RGBA frame is ${expected}.`,
    );
  }
  if (current.length !== expected) {
    throw new Error(
      `The decoded overlay is ${current.length} bytes; a ${width}x${height} RGBA frame is ${expected}.`,
    );
  }

  const changed: OverlaySegment[] = [];
  const visible: OverlaySegment[] = [];

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * width * 4;

    for (const segment of segmentsInRow(width, (x) => {
      const at = rowStart + x * 4;
      return changedAt(previous, current, at) ? (current[at + 3] ?? 0) : 0;
    })) {
      changed.push({
        offset: y * width + segment.x,
        width: segment.width,
        at: rowStart + segment.x * 4,
      });
    }

    for (const segment of segmentsInRow(
      width,
      (x) => current[rowStart + x * 4 + 3] ?? 0,
    )) {
      visible.push({
        offset: y * width + segment.x,
        width: segment.width,
        at: rowStart + segment.x * 4,
      });
    }
  }

  const message = new Uint8Array(
    changed.reduce((total, segment) => total + 5 + segment.width * 3, 0) +
      visible.length * 5,
  );
  let at = 0;
  const view = new DataView(message.buffer);

  for (const segment of changed) {
    writeUint24(message, at, segment.offset);
    view.setUint16(at + 3, segment.width);
    at += 5;

    for (let pixel = 0; pixel < segment.width; pixel += 1) {
      const index = segment.at + pixel * 4;
      const cell = segment.offset + pixel;
      const x = cell % width;
      const y = (cell - x) / width;
      const red = dither(current[index] ?? 0, x, y);
      const green = dither(current[index + 1] ?? 0, x, y);
      const blue = dither(current[index + 2] ?? 0, x, y);
      const alpha = Math.floor(((current[index + 3] ?? 0) / 255) * 15);

      message[at] = (blue << 4) | ((alpha & 0xc) >> 2);
      message[at + 1] = (green << 4) | (alpha & 0x3);
      message[at + 2] = red << 4;
      at += 3;
    }
  }

  for (const segment of visible) {
    writeUint24(message, at, segment.offset);
    view.setUint16(at + 3, segment.width);
    at += 5;
  }

  const payload =
    message.length > FRAME_SIZE ? joinChunks(message, PAYLOAD_CHUNK) : message;
  const trailer = overlayTrailer(payload.length);
  const body = new Uint8Array(payload.length + trailer.bytes.length);
  body.set(payload);
  body.set(trailer.bytes, payload.length);

  return {
    // The size field counts the message before chunk separators, not the body;
    // the aligned form reports +7 even though its trailer is eight bytes.
    imageSize: message.length + (trailer.extra === 0 ? 2 : 7),
    visibleBytes: visible.length * 5 + (trailer.extra === 0 ? 0 : 5),
    body,
  };
}
