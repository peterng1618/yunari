import fs from "node:fs/promises";
import path from "node:path";

/**
 * The bytes of `relativePath` under `root`, or `undefined` when the file is
 * absent, unreadable, lands outside `root` once links are resolved, or is past
 * `maxBytes`.
 *
 * A theme folder is untrusted input — it is whatever an imported package (or a
 * person) left on disk — so a path it declares is not a path this host will
 * follow anywhere. `realpath` on both sides is the whole check: a file that
 * resolves outside the root is not the theme's file, whether the way out is a
 * `..` in the declaration or a junction standing where an asset belongs.
 *
 * `maxBytes` is the caller's own bound, applied to the resolved file's size
 * *before* it is read: without it a hostile folder makes the host buffer an
 * arbitrarily large file only to refuse it afterwards. A caller with no bound
 * of its own leaves it out and gets the file whatever its size.
 *
 * The root is resolved too, and for the same reason `serve/static-path` does
 * it: a library reached through a link (a temp directory under `/var` on macOS)
 * must not make its own files look outside.
 *
 * `relativePath` splits on `/`, the separator the theme format declares, so a
 * document written on one platform reads the same on another.
 */
export async function readContainedFile(
  root: string,
  relativePath: string,
  maxBytes?: number,
): Promise<Buffer | undefined> {
  try {
    const realRoot = await fs.realpath(root);
    const real = await fs.realpath(path.join(root, ...relativePath.split("/")));
    const within = path.relative(realRoot, real);
    // A separator boundary, not a prefix: `..foo` beside the root is a sibling
    // whose name merely begins with the marker, and the root itself is not a
    // file this may read.
    if (
      within === "" ||
      within === ".." ||
      within.startsWith(`..${path.sep}`) ||
      path.isAbsolute(within)
    ) {
      return undefined;
    }
    if (maxBytes !== undefined) {
      const stat = await fs.stat(real);
      if (stat.size > maxBytes) {
        return undefined;
      }
    }
    return await fs.readFile(real);
  } catch {
    return undefined;
  }
}
