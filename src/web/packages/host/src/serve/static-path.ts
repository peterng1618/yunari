import fs from "node:fs/promises";
import path from "node:path";

/** URL-path resolution and bundle content-type rules. */

/** Allowlist for bundle asset types; unknown extensions stay octet-stream. */
const CONTENT_TYPES = new Map<string, string>([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  // The registered media type for the extension. `application/json` would also
  // be read, but this file is a manifest and the allowlist should say so; the
  // player is the only bundle that ships one (docs/decisions/0071).
  [".webmanifest", "application/manifest+json"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".avif", "image/avif"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".ttf", "font/ttf"],
  [".otf", "font/otf"],
  [".ico", "image/x-icon"],
  [".map", "application/json; charset=utf-8"],
]);

export function contentTypeFor(filePath: string): string {
  return (
    CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) ??
    "application/octet-stream"
  );
}

/** Relative editor assets require `/editor/`, not `/editor`. */
export function needsTrailingSlash(urlPath: string, mount: string): boolean {
  const withoutQuery = urlPath.split("?")[0] ?? "";

  return withoutQuery === mount;
}

/** Resolves inside `root`; returns undefined for malformed or escaping paths. */
export function resolveStaticPath(
  root: string,
  urlPath: string,
): string | undefined {
  let decoded: string;

  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }

  if (decoded.includes("\0")) {
    return undefined;
  }

  const withoutQuery = decoded.split("?")[0] ?? "";
  const relative = withoutQuery.replace(/^\/+/, "");
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, relative);

  // Require a path-separator boundary so similarly prefixed sibling roots are rejected.
  if (
    candidate !== resolvedRoot &&
    !candidate.startsWith(resolvedRoot + path.sep)
  ) {
    return undefined;
  }

  return candidate;
}

/**
 * Where a bundle request really lands, or `undefined` when this host will not
 * serve it: outside `root`, missing, a dotfile, or a link.
 *
 * **`fs.realpath` alone is not the check.** It resolves a link before the prefix
 * check can see it, so a link pointing inside the root would pass; the plan's
 * word is "links", and a bundle is build output that writes none, so every
 * component from the root down is `lstat`ed first. The realpath then answers the
 * case `lstat` cannot: a root that is itself reached through a link (`/var` on
 * macOS) must not make its own files look outside.
 */
export async function realStaticPath(
  root: string,
  urlPath: string,
): Promise<string | undefined> {
  const resolved = resolveStaticPath(root, urlPath);

  if (resolved === undefined) return undefined;

  const rootPath = path.resolve(root);
  const parts = path
    .relative(rootPath, resolved)
    .split(path.sep)
    .filter((part) => part.length > 0);

  // A build writes no dotfile, so a path naming one is not a bundle request.
  if (parts.some((part) => part.startsWith("."))) return undefined;

  let current = rootPath;

  for (const part of parts) {
    current = path.join(current, part);

    try {
      if ((await fs.lstat(current)).isSymbolicLink()) return undefined;
    } catch {
      return undefined;
    }
  }

  let realRoot: string;
  let real: string;

  try {
    realRoot = await fs.realpath(rootPath);
    real = await fs.realpath(resolved);
  } catch {
    return undefined;
  }

  // Require a separator boundary, as `resolveStaticPath` does: a sibling root
  // whose name merely begins with this one's must stay out.
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
    return undefined;
  }

  return real;
}
