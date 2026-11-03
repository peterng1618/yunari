import { type FileHandle, open } from "node:fs/promises";
import { readVideoFactsFrom } from "@yunari/theme-package";

/**
 * A video item's length, read from its box headers without loading the clip.
 *
 * A wallpaper can be hundreds of megabytes and the row needs one number; the
 * reader asks the file for `ftyp` and `moov` and skips everything between.
 * Anything that cannot be read — a non-MP4, a truncated file, a refused
 * handle — is absent rather than zero: an unknown duration must not be shown
 * as a clip that is already a second long.
 */
export async function videoDurationMs(
  file: string,
): Promise<number | undefined> {
  let handle: FileHandle | undefined;

  try {
    handle = await open(file, "r");
    const opened = handle;
    const { size } = await opened.stat();
    if (size <= 0) return undefined;

    const facts = await readVideoFactsFrom({
      size,
      async read(offset, length) {
        const buffer = Buffer.alloc(Math.min(length, size - offset));
        const { bytesRead } = await opened.read(
          buffer,
          0,
          buffer.length,
          offset,
        );
        return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead);
      },
    });
    return facts?.durationMs;
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => {});
  }
}
