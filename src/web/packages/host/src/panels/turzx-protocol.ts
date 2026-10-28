/**
 * The TURZX 5" panel's wire format: every write padded to a 250-byte multiple,
 * pixels sent as BGRA in 249-byte chunks, and a text HELLO that names the
 * panel.
 *
 * Pure, so the verified probe bytes are testable without hardware. Nothing here
 * opens a port; the adapter owns the transport (decision 0133).
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
  const text = new TextDecoder("latin1").decode(reply).replace(/[\0\s]+$/, "");
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
  const chunks = Math.ceil(bgra.length / PAYLOAD_CHUNK);
  const joined = new Uint8Array(bgra.length + Math.max(0, chunks - 1));
  let offset = 0;

  for (let start = 0; start < bgra.length; start += PAYLOAD_CHUNK) {
    if (start > 0) {
      joined[offset] = 0x00;
      offset += 1;
    }

    const end = Math.min(start + PAYLOAD_CHUNK, bgra.length);
    joined.set(bgra.subarray(start, end), offset);
    offset += end - start;
  }

  return frame(joined);
}

/**
 * The verified command table (probe recorded in the spec and decision 0133).
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
  uploadFile: Uint8Array.of(0x6f, 0xef, 0x69, 0x00, 0x00, 0x00),
  getFileSize: Uint8Array.of(0x6e, 0xef, 0x69, 0x00, 0x00, 0x00),
  deleteFile: Uint8Array.of(0x66, 0xef, 0x69, 0x00, 0x00, 0x00),
} as const;
