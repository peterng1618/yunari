import { type FileHandle, open } from "node:fs/promises";

/**
 * What container a wallpaper video's bytes actually use.
 *
 * Wallpaper Engine names a payload by its descriptor's file name, and that name
 * can disagree with the bytes: an item whose payload is called `clip.mp4` may
 * hold Matroska. The publish envelope takes only an H.264 MP4, so the listing
 * and the byte route both have to state the container the bytes prove rather
 * than the extension the descriptor guessed.
 *
 * Only a header is read. The DocType names `webm` for the WebM subset and
 * `matroska` otherwise; EBML without a readable DocType is still the Matroska
 * family, and its served type is the family's.
 */

export type VideoContainer = "mp4" | "webm" | "matroska" | "unknown";

/** Enough for the EBML header and the DocType it carries. */
const HEADER_BYTES = 1024;

const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3] as const;
const MP4_FTYP = "ftyp";

function magicOf(bytes: Uint8Array): boolean {
  return EBML_MAGIC.every((byte, index) => bytes[index] === byte);
}

function asciiOf(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

export function videoContainerOf(header: Uint8Array): VideoContainer {
  if (header.length >= 8 && asciiOf(header.subarray(4, 8)) === MP4_FTYP) {
    return "mp4";
  }
  if (header.length < EBML_MAGIC.length || !magicOf(header)) return "unknown";

  return asciiOf(header).includes("webm") ? "webm" : "matroska";
}

/** The registered media type for a container sniffed from its header. */
export function videoContentTypeOf(container: VideoContainer): string {
  switch (container) {
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "matroska":
      return "video/x-matroska";
    case "unknown":
      return "application/octet-stream";
  }
}

/** The container of the file at `path`, or `unknown` when it cannot be read. */
export async function videoContainerAt(path: string): Promise<VideoContainer> {
  let handle: FileHandle | undefined;

  try {
    handle = await open(path, "r");
    const buffer = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEADER_BYTES, 0);
    return videoContainerOf(
      new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead),
    );
  } catch {
    return "unknown";
  } finally {
    await handle?.close().catch(() => {});
  }
}
