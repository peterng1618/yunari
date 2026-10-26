import type { AssetKind } from "./document.js";

/**
 * The media type each registered asset extension answers.
 *
 * Declared first because the extension table below is typed from its keys, so a
 * format the host cannot type is a compile error rather than a 415 at runtime.
 * Both halves live here because they decide one question: the package says what
 * an asset is, and the host serves the bytes as that and nothing else. A path
 * and a kind are independent fields an author writes, so the pair — not the
 * extension alone — is what admits a file.
 */
const CONTENT_TYPES = {
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
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
} as const;

type AssetExtension = keyof typeof CONTENT_TYPES;

/** The extensions each declared kind may carry. */
export const ASSET_EXTENSIONS: Readonly<
  Record<AssetKind, readonly AssetExtension[]>
> = {
  image: ["png", "jpg", "jpeg", "webp", "avif"],
  svg: ["svg"],
  gif: ["gif"],
  video: ["mp4", "webm"],
  font: ["woff2", "woff", "ttf", "otf"],
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

  // The table tie makes every entry to `allowed` a key of `CONTENT_TYPES`.
  return CONTENT_TYPES[extension as AssetExtension];
}
