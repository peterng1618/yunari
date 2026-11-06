import { createHash } from "node:crypto";

/**
 * Array order differs between otherwise equal strings, and comparing UTF-16
 * code units orders astral characters before the BMP range above them. The
 * lines below are sorted by code point so one file set has one hash whatever
 * order the archive listed it in.
 */
function compareCodePoints(left: string, right: string): number {
  const a = [...left];
  const b = [...right];
  const shared = Math.min(a.length, b.length);

  for (let index = 0; index < shared; index += 1) {
    const difference =
      (a[index] as string).codePointAt(0)! -
      (b[index] as string).codePointAt(0)!;
    if (difference !== 0) return difference;
  }

  return a.length - b.length;
}

/**
 * The content a consent fingerprint binds: every file path and the SHA-256 of
 * its bytes, as `path NUL sha256(bytes) NUL` lines under one outer SHA-256.
 * Lowercase hex, no prefix — the same shape the store and the host compare.
 */
export function contentHash(
  files: Readonly<Record<string, Uint8Array>>,
): string {
  const lines = Object.keys(files)
    .sort(compareCodePoints)
    .map((path) => {
      const digest = createHash("sha256")
        .update(files[path] as Uint8Array)
        .digest("hex");
      return `${path}\0${digest}\0`;
    });

  return createHash("sha256").update(lines.join("\n")).digest("hex");
}
