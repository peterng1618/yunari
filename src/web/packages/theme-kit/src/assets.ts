import type {
  AssetKind,
  AssetReference,
  FabricThemeEnvelope,
} from "@yunari/renderer-core";
import { YUNARI_ASSET_PROPERTY } from "@yunari/scene-fabric";
import type { ThemeCreditsEntry } from "@yunari/theme-package";

/**
 * Asset declaration from bytes.
 *
 * The declaration, the digest and the credit are one fact: an imported asset is
 * not imported until it carries its attribution, and the path is derived from
 * the bytes so two imports of the same file cannot land on two paths.
 *
 * The bytes themselves never enter the envelope. A package writes them at their
 * declared path; the envelope only names them.
 */

/**
 * One asset's ceiling, and the trash route's own per-file cap.
 *
 * The host store re-exports this value, so a theme this kit accepts is one the
 * store writes and neither package holds a private copy of the number.
 */
export const MAX_ASSET_BYTES = 80 * 1024 * 1024;

/** The extensions this build can declare, and the kind each one is. */
const EXTENSION_KINDS: Readonly<Record<string, AssetKind>> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  avif: "image",
  svg: "svg",
  gif: "gif",
  mp4: "video",
  webm: "video",
  mov: "video",
  woff2: "font",
  woff: "font",
  ttf: "font",
  otf: "font",
};

export interface DeclareAssetInput {
  /** The file's path or name as the user gave it. Must be relative. */
  readonly path: string;
  readonly bytes: Uint8Array;
  /** The credit's title; the file's stem when omitted. */
  readonly title?: string;
  /** The credit's author; omitted when the source names none. */
  readonly author?: string;
  /** The licence as the source or the user stated it. */
  readonly license: string;
  readonly sourceUrl?: string;
  readonly changes?: string;
}

export interface DeclaredAsset {
  readonly reference: AssetReference;
  readonly bytes: Uint8Array;
  readonly credit: ThemeCreditsEntry;
}

/** SHA-256 as lower-case hex. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle !== undefined) {
    const digest = await subtle.digest(
      "SHA-256",
      bytes as unknown as BufferSource,
    );
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
  // Keep the browser bundle free of a static node builtin: a caller without
  // WebCrypto is a Node process, where this dynamic import resolves.
  const specifier = "node:crypto";
  const { createHash } = (await import(
    /* @vite-ignore */ specifier
  )) as typeof import("node:crypto");
  return createHash("sha256").update(bytes).digest("hex");
}

function extensionOf(path: string): string {
  const at = path.lastIndexOf(".");
  return at < 0 ? "" : path.slice(at + 1).toLowerCase();
}

/**
 * Refuses a path this build cannot place under the package's `assets/` folder.
 *
 * Absolute paths, parent traversal, a scheme and an unknown extension are all
 * refused before a byte is read: a declaration is a promise about where the
 * package will find the file.
 */
function checkPath(path: string): {
  readonly ext: string;
  readonly kind: AssetKind;
} {
  if (path === "") throw new Error("An asset needs a path.");
  if (
    path.startsWith("/") ||
    path.startsWith("\\") ||
    path.startsWith("~") ||
    /^[A-Za-z]:/.test(path) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(path)
  ) {
    throw new Error(`"${path}" is not a relative asset path.`);
  }
  const segments = path.split(/[\\/]+/);
  if (segments.some((segment) => segment === "..")) {
    throw new Error(`"${path}" leaves the asset folder.`);
  }
  const ext = extensionOf(path);
  const kind = EXTENSION_KINDS[ext];
  if (kind === undefined) {
    throw new Error(
      `"${path}" is not an image, video or font this build can declare.`,
    );
  }
  return { ext, kind };
}

/**
 * The kind a path's extension declares, or a refusal naming the path.
 *
 * Exposed so a caller that reads bytes from disk can refuse an unsupported
 * extension before the read, instead of holding a second copy of this table.
 */
export function assetKindForPath(path: string): AssetKind {
  return checkPath(path).kind;
}

/** A readable, stable path segment from the file's own stem. */ function slugOf(
  path: string,
): string {
  const base = path.split(/[\\/]+/).pop() ?? path;
  const stem = base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base;
  const slug = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug === "" ? "asset" : slug;
}

/**
 * Declares one asset from its bytes.
 *
 * The id and path are derived from the file's stem and its digest, so
 * re-importing the same bytes is the same declaration rather than a second
 * copy. A different file with the same name gets a different digest and a
 * different path.
 */
export async function declareAsset(
  input: DeclareAssetInput,
): Promise<DeclaredAsset> {
  const { ext, kind } = checkPath(input.path);
  const bytes = input.bytes;
  if (!(bytes instanceof Uint8Array)) {
    throw new Error("An asset declaration needs its bytes as a Uint8Array.");
  }
  if (bytes.byteLength > MAX_ASSET_BYTES) {
    throw new Error(
      `"${input.path}" is larger than the ${MAX_ASSET_BYTES} byte asset cap.`,
    );
  }
  if (bytes.byteLength === 0) {
    throw new Error(`"${input.path}" is empty.`);
  }

  const sha256 = await sha256Hex(bytes);
  const slug = slugOf(input.path);
  const id = `${slug}-${sha256.slice(0, 8)}`;
  const path = `assets/${slug}-${sha256.slice(0, 8)}.${ext}`;
  const title = input.title ?? slug;
  const reference: AssetReference = {
    id,
    kind,
    path,
    sha256,
    ...(input.sourceUrl === undefined ? {} : { sourceUrl: input.sourceUrl }),
    license: { name: input.license },
  };
  const credit: ThemeCreditsEntry = {
    kind,
    title,
    ...(input.author === undefined ? {} : { author: { name: input.author } }),
    ...(input.sourceUrl === undefined
      ? {}
      : { source: { url: input.sourceUrl } }),
    license: input.license,
    changes: input.changes ?? "Imported unchanged",
    assetId: id,
  };
  return { reference, bytes, credit };
}

/**
 * Adds a declared asset to the envelope.
 *
 * The bytes travel beside the envelope in a package; this only writes the
 * declaration the envelope owns. A re-declaration under the same id replaces
 * the old reference rather than listing the asset twice.
 */
export function addAsset(
  envelope: FabricThemeEnvelope,
  reference: AssetReference,
  bytes: Uint8Array,
): FabricThemeEnvelope {
  if (bytes.byteLength > MAX_ASSET_BYTES) {
    throw new Error(
      `"${reference.path}" is larger than the ${MAX_ASSET_BYTES} byte asset cap.`,
    );
  }
  const next = structuredClone(envelope);
  const existing = next.assets ?? [];
  const at = existing.findIndex((asset) => asset.id === reference.id);
  const assets =
    at < 0
      ? [...existing, reference]
      : existing.map((asset) =>
          asset.id === reference.id ? reference : asset,
        );
  return { ...next, assets };
}

/** Removes one asset declaration; the bytes are the caller's to drop. */
export function removeAsset(
  envelope: FabricThemeEnvelope,
  assetId: string,
): FabricThemeEnvelope {
  const next = structuredClone(envelope);
  const existing = next.assets ?? [];
  if (!existing.some((asset) => asset.id === assetId)) {
    throw new Error(`There is no asset "${assetId}" in this theme.`);
  }
  const assets = existing.filter((asset) => asset.id !== assetId);
  return { ...next, assets };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * What holds an asset, in the author's terms, or `undefined` when nothing does.
 *
 * Removing a referenced asset would leave a scene object or a font face naming
 * bytes the package no longer carries, which the validator refuses. The answer
 * names one owner so a refusal can say what to change first.
 */
export function assetOwner(
  envelope: FabricThemeEnvelope,
  assetId: string,
): string | undefined {
  if (envelope.background?.media?.assetId === assetId) return "the background";

  for (const [id, token] of Object.entries(
    envelope.globals?.typeTokens ?? {},
  )) {
    if (token.face?.assetId === assetId) return `type token "${id}"`;
  }

  const walk = (
    object: Readonly<Record<string, unknown>>,
  ): string | undefined => {
    const reference = object[YUNARI_ASSET_PROPERTY];
    if (isRecord(reference) && reference["assetId"] === assetId) {
      return `object "${String(object["id"])}"`;
    }
    const children = object["objects"];
    if (!Array.isArray(children)) return undefined;
    for (const child of children) {
      if (isRecord(child)) {
        const owner = walk(child);
        if (owner !== undefined) return owner;
      }
    }
    return undefined;
  };

  const scene = isRecord(envelope.scene) ? envelope.scene : {};
  const objects = Array.isArray(scene["objects"]) ? scene["objects"] : [];
  for (const object of objects) {
    if (!isRecord(object)) continue;
    const owner = walk(object);
    if (owner !== undefined) return owner;
  }
  return undefined;
}
