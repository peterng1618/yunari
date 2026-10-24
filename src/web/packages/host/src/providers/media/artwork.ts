import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Media artwork as files on disk: content-addressed by the SHA-256 of the
 * bytes, so a changed track cannot be served under the previous picture.
 *
 * Synchronous on purpose. A write happens once per track change and a read is
 * one small file, so the pause is a disk access, not a poll; the async-shaped
 * interface keeps the route and the provider from depending on that.
 */

/** The only names the route will serve, and the only files the cache writes. */
export const ARTWORK_NAME = /^[0-9a-f]{64}\.(png|jpg|jpeg|webp)$/;

export type ArtworkExtension = "png" | "jpg" | "jpeg" | "webp";

export interface ArtworkCache {
  put(bytes: Uint8Array, ext: string): Promise<string>;
  read(name: string): Promise<{ bytes: Uint8Array; ext: string } | undefined>;
}

/** MIME for each accepted extension; a name outside the set never gets here. */
export function artworkContentType(ext: string): string {
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

/**
 * The format the bytes actually are. The helper already sniffs before it emits,
 * but the cache is the thing that names the file, so it does not trust the
 * caller's extension either.
 */
export function sniffArtworkExtension(
  bytes: Uint8Array,
): ArtworkExtension | undefined {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "png";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "jpg";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  ) {
    return "webp";
  }
  return undefined;
}

/**
 * Keeps the newest `cap` files. Ties on mtime fall back to the name so two
 * files written in the same millisecond still evict deterministically.
 */
function prune(directory: string, cap: number): void {
  let names: string[];

  try {
    names = fs.readdirSync(directory).filter((name) => ARTWORK_NAME.test(name));
  } catch {
    return;
  }

  if (names.length <= cap) return;

  const dated = names.map((name) => {
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(path.join(directory, name)).mtimeMs;
    } catch {
      // A file that disappeared is already gone; it just sorts oldest.
    }
    return { name, mtimeMs };
  });

  dated.sort((a, b) =>
    b.mtimeMs === a.mtimeMs
      ? a.name.localeCompare(b.name)
      : b.mtimeMs - a.mtimeMs,
  );

  for (const { name } of dated.slice(cap)) {
    try {
      fs.unlinkSync(path.join(directory, name));
    } catch {
      // Losing an eviction to a concurrent reader of the same entry is fine:
      // the next write prunes again.
    }
  }
}

export function createArtworkCache(directory: string, cap = 64): ArtworkCache {
  const fileOf = (name: string): string => path.join(directory, name);

  return {
    async put(bytes, ext) {
      const sniffed = sniffArtworkExtension(bytes);

      // The bytes decide the extension. The claimed one is only named in the
      // refusal, so a caller cannot label a picture as a format it is not.
      if (sniffed === undefined || bytes.length === 0) {
        throw new Error(
          `The artwork bytes are not a supported image (claimed ${ext}).`,
        );
      }

      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const name = `${sha256}.${sniffed}`;

      fs.mkdirSync(directory, { recursive: true });

      // Write beside the target and rename, so a reader never sees half an
      // image under a name that promises the whole digest.
      const scratch = fileOf(`.${name}.${process.pid}.${Date.now()}.tmp`);
      fs.writeFileSync(scratch, bytes);
      fs.renameSync(scratch, fileOf(name));

      prune(directory, Math.max(1, cap));

      return `/api/media/artwork/${name}`;
    },

    async read(name) {
      if (!ARTWORK_NAME.test(name)) return undefined;

      let bytes: Uint8Array;

      try {
        bytes = new Uint8Array(fs.readFileSync(fileOf(name)));
      } catch {
        return undefined;
      }

      // The name is the address, so bytes that do not hash to it are not this
      // entry: a truncated or replaced file is an absence, not a wrong picture.
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (!name.startsWith(`${sha256}.`)) return undefined;

      return { bytes, ext: name.slice(name.lastIndexOf(".") + 1) };
    },
  };
}
