import type { AssetKind } from "./document.js";

/**
 * The one table binding a declared asset kind to the extensions it may carry
 * and the media type each answers.
 *
 * Both halves live here because they decide one question: the package says what
 * an asset is, and the host serves the bytes as that and nothing else. A path
 * and a kind are independent fields an author writes, so the pair — not the
 * extension alone — is what admits a file.
 */

export const ASSET_EXTENSIONS: Readonly<Record<AssetKind, readonly string[]>> =
  {
    image: ["png", "jpg", "jpeg", "webp", "avif"],
    svg: ["svg"],
    gif: ["gif"],
    video: ["mp4", "webm"],
    font: ["woff2"],
  };

/** The registered media type for each extension the table above admits. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  woff2: "font/woff2",
};

function extensionsOf(kind: string): readonly string[] | undefined {
  return Object.hasOwn(ASSET_EXTENSIONS, kind)
    ? ASSET_EXTENSIONS[kind as AssetKind]
    : undefined;
}

/** The last segment's extension, lowercase and without the dot. */
function extensionOf(assetPath: string): string | undefined {
  const segment = assetPath.slice(assetPath.lastIndexOf("/") + 1);
  const dot = segment.lastIndexOf(".");

  return dot <= 0 ? undefined : segment.slice(dot + 1).toLowerCase();
}

/**
 * The media type the declared kind gives a path, or undefined when the pair is
 * not a package that may be served: an unknown kind, or an extension that kind
 * does not name.
 */
export function themeAssetContentType(asset: {
  readonly kind: string;
  readonly path: string;
}): string | undefined {
  const extension = extensionOf(asset.path);
  const allowed = extensionsOf(asset.kind);

  if (
    extension === undefined ||
    allowed === undefined ||
    !allowed.includes(extension)
  ) {
    return undefined;
  }

  return CONTENT_TYPES[extension];
}
