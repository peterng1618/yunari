import {
  type AssetReference,
  type FabricThemeEnvelope,
  FONT_ASSET_FORMATS,
  type FontAssetFormat,
  type FontAssetReference,
} from "@yunari/renderer-core";
import {
  objectAssetReference,
  setObjectAssetReference,
} from "@yunari/scene-fabric";
import {
  FabricImage,
  type FabricObject,
  Group,
  type StaticCanvas,
} from "fabric/es";
import type { EditorInteraction } from "../editor-interaction.js";
import type { CuratedFontFace } from "../font-catalog.js";
import { boundedImageElement } from "../image-manager/index.js";
import {
  FONT_WEIGHT_MAX,
  FONT_WEIGHT_MIN,
  type FontMetadata,
} from "./font-metadata.js";

const TYPES = {
  png: { mime: "image/png", kind: "image" },
  jpg: { mime: "image/jpeg", kind: "image" },
  jpeg: { mime: "image/jpeg", kind: "image" },
  webp: { mime: "image/webp", kind: "image" },
  svg: { mime: "image/svg+xml", kind: "svg" },
  mp4: { mime: "video/mp4", kind: "video" },
  webm: { mime: "video/webm", kind: "video" },
  woff2: { mime: "font/woff2", kind: "font" },
  woff: { mime: "font/woff", kind: "font" },
  ttf: { mime: "font/ttf", kind: "font" },
  otf: { mime: "font/otf", kind: "font" },
} as const;

type AssetExtension = keyof typeof TYPES;

/**
 * The extensions `TYPES` can read, in declaration order.
 *
 * Exported so a file chooser can filter on the *same* list the manager
 * validates: a second copy drifts silently in the widening direction, where the
 * manager would accept a file the chooser never offers.
 */
export const ASSET_FILE_EXTENSIONS = Object.keys(
  TYPES,
) as readonly AssetExtension[];

type AssetKind = (typeof TYPES)[AssetExtension]["kind"];
export type LocalAssetReference =
  | (AssetReference & { readonly kind: AssetKind })
  | FontAssetReference;
/** The kinds a canvas image can be bound to; a video or a font is packaged
    without ever becoming an object. */
export type PlacedAssetReference = AssetReference & {
  readonly kind: "image" | "svg";
};

/** Owns declared package bytes and the disposable browser previews derived from them. */
export class AssetManager {
  #assets: Record<string, Uint8Array> = {};
  #declarations: LocalAssetReference[] = [];
  #previewUrls = new Map<string, string>();

  get assets(): Readonly<Record<string, Uint8Array>> {
    return { ...this.#assets };
  }

  get declarations(): readonly LocalAssetReference[] {
    return this.#declarations;
  }

  /**
   * Declares a file as an asset AND puts it on the canvas.
   *
   * Both halves or neither. An image placed without a declaration keeps the
   * `blob:` URL it was decoded from, which is a handle into one browser
   * session's memory: it means nothing in another tab, on a phone, or on a
   * second visit — and the document still saves, so the loss is silent. The
   * assets pane and a pasted image both go through here so neither can take the
   * half-only path.
   */
  async placeImage(
    editor: EditorInteraction,
    file: File,
    /** The declaration the caller already made, so a caller that imports first
     *  and then places does not declare the same file twice. */
    declared?: LocalAssetReference,
  ): Promise<FabricImage | undefined> {
    const asset = declared ?? (await this.import(file));
    const imported = await editor.imageManager.importImage({
      source: file,
      withoutSave: true,
    });
    if (imported === null || !(imported.image instanceof FabricImage)) {
      return undefined;
    }
    // Only images and SVG reach here, and both are the kinds an image object
    // can carry — a font or a video has no image object to point at.
    if (asset.kind !== "image" && asset.kind !== "svg") return undefined;
    setObjectAssetReference(imported.image, {
      assetId: asset.id,
      kind: asset.kind,
    });
    imported.image.setCoords();
    editor.canvas.setActiveObject(imported.image);
    // R3: an import's one automatic placement is the canvas centre, so every
    // "place this file" path lands where the author is looking rather than at
    // the object's default origin.
    editor.canvas.centerObject(imported.image);
    return imported.image;
  }

  async import(file: File): Promise<LocalAssetReference> {
    const extension = extensionOf(file.name);
    if (extension === undefined)
      throw new Error("Unsupported asset file type.");
    const type = TYPES[extension];
    if (file.type !== type.mime)
      throw new Error("File MIME type does not match its extension.");

    const bytes = new Uint8Array(await file.arrayBuffer());
    const previewBytes = extension === "svg" ? sanitisedSvg(bytes) : bytes;
    const { id, path } = this.#allocate(file.name, extension);
    const reference: LocalAssetReference = {
      id,
      kind: type.kind,
      path,
      sha256: await sha256(bytes),
    };

    this.#assets[path] = bytes;
    this.#declarations.push(reference);
    if (type.kind === "image" || type.kind === "svg") {
      this.#previewUrls.set(
        id,
        URL.createObjectURL(
          new Blob([previewBytes as unknown as BlobPart], { type: type.mime }),
        ),
      );
    }
    return reference;
  }

  async adoptFont(
    face: CuratedFontFace,
    bytes: Uint8Array,
  ): Promise<LocalAssetReference> {
    const path = `assets/${face.id}.woff2`;
    const reference: LocalAssetReference = {
      id: face.id,
      kind: "font",
      path,
      sha256: await sha256(bytes),
      family: face.family,
      weight: face.weight,
      style: face.style,
      format: face.format,
      sourceUrl: face.sourceUrl,
      license: face.license,
    };
    const existing = this.#declarations.findIndex(
      (asset) => asset.id === face.id,
    );
    if (existing >= 0) this.#declarations.splice(existing, 1, reference);
    else this.#declarations.push(reference);
    this.#assets[path] = new Uint8Array(bytes);
    return reference;
  }

  /**
   * Declares a local font with the metadata its filename cannot settle.
   *
   * The bytes are validated by the browser's own parser before anything is
   * declared: a file that is not a font would otherwise sit in the package as a
   * shapeless declaration, and a second, weaker signature check here would be
   * exactly the wrong owner. `loadFace` is the browser's `FontFace`; jsdom has
   * none, so a test injects one.
   */
  async importFont(
    file: File,
    metadata: FontMetadata,
    loadFace: FontLoader = loadWithFontFace,
  ): Promise<FontAssetReference> {
    const checked = fontMetadataOrThrow(metadata);
    const extension = extensionOf(file.name);
    if (extension === undefined || !isFontFormat(extension))
      throw new Error("Unsupported font file type.");

    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      await loadFace(checked.family, bytes);
    } catch {
      throw new Error("The file's bytes are not a font the browser can read.");
    }

    // `import` has already validated the MIME type and allocated the path;
    // amending it is what writes the facts the file cannot answer.
    const imported = await this.import(file);
    return this.amendFont(imported.id, checked);
  }

  /** Declares a face: the bytes, path and id are the declaration's, and the
   *  form's values are the facts about it. */
  amendFont(assetId: string, metadata: FontMetadata): FontAssetReference {
    const checked = fontMetadataOrThrow(metadata);
    const index = this.#declarations.findIndex((asset) => asset.id === assetId);
    const existing = this.#declarations[index];
    if (index < 0 || existing === undefined || existing.kind !== "font")
      throw new Error(`No declared font to amend: ${assetId}.`);

    // A bare import writes no `format`; the path's tail is the one `#allocate`
    // gave it, so the declaration and the file name cannot disagree.
    const format =
      "format" in existing ? existing.format : extensionOf(existing.path);
    if (format === undefined || !isFontFormat(format))
      throw new Error(`No declared font to amend: ${assetId}.`);

    const {
      sourceUrl: _previousSourceUrl,
      license: _previousLicense,
      ...kept
    } = existing;
    const next: FontAssetReference = {
      ...kept,
      kind: "font",
      format: format as FontAssetFormat,
      family: checked.family,
      weight: checked.weight,
      style: checked.style,
      license: { name: checked.licence },
      ...(checked.sourceUrl === undefined
        ? {}
        : { sourceUrl: checked.sourceUrl }),
    };
    this.#declarations.splice(index, 1, next);
    return next;
  }

  remove(assetId: string): boolean {
    const index = this.#declarations.findIndex((asset) => asset.id === assetId);
    if (index < 0) return false;
    const [asset] = this.#declarations.splice(index, 1);
    if (asset !== undefined) delete this.#assets[asset.path];
    this.#revoke(assetId);
    return true;
  }

  /**
   * Swaps an asset's bytes for another's, keeping the id and path.
   *
   * Replacing is not importing: the author picked an existing asset, so every
   * object and every reference bound to that id keeps working and the package
   * does not grow. The declaration keeps its curated metadata — a font's family
   * and licence came from the catalogue, not from the file — and only the
   * digest and the bytes change.
   */
  async replace(assetId: string, file: File): Promise<LocalAssetReference> {
    const index = this.#declarations.findIndex((asset) => asset.id === assetId);
    const existing = this.#declarations[index];
    if (index < 0 || existing === undefined)
      throw new Error(`No declared asset to replace: ${assetId}.`);

    const extension = extensionOf(file.name);
    if (extension === undefined)
      throw new Error("Unsupported asset file type.");
    const type = TYPES[extension];
    if (file.type !== type.mime)
      throw new Error("File MIME type does not match its extension.");
    // A different extension would leave the declared path claiming bytes of a
    // format the package's readers do not expect at that name.
    if (extensionOf(existing.path) !== extension)
      throw new Error("A replacement must keep the asset's file extension.");

    const bytes = new Uint8Array(await file.arrayBuffer());
    const next = await this.replaceBytes(assetId, bytes);
    if (type.kind === "image" || type.kind === "svg") {
      const previewBytes = extension === "svg" ? sanitisedSvg(bytes) : bytes;
      this.#previewUrls.set(
        assetId,
        URL.createObjectURL(
          new Blob([previewBytes as unknown as BlobPart], { type: type.mime }),
        ),
      );
    }
    return next;
  }

  /**
   * Swaps an asset's bytes for bytes this manager did not read from a file —
   * the host's normalized copy of a video. The declaration keeps its id, path,
   * kind and any curated metadata; only the digest and the bytes change, so
   * every reference bound to that id keeps working and the package does not
   * grow.
   */
  async replaceBytes(
    assetId: string,
    bytes: Uint8Array,
  ): Promise<LocalAssetReference> {
    const index = this.#declarations.findIndex((asset) => asset.id === assetId);
    const existing = this.#declarations[index];
    if (index < 0 || existing === undefined)
      throw new Error(`No declared asset to replace: ${assetId}.`);

    const { sha256: _drop, ...kept } = existing;
    const next: LocalAssetReference = {
      ...kept,
      sha256: await sha256(bytes),
    };
    this.#assets[existing.path] = bytes;
    this.#declarations.splice(index, 1, next);
    // The preview URL is a blob of the old bytes; keeping it would leave the
    // pane showing the picture the author just replaced.
    this.#revoke(assetId);
    return next;
  }

  load(
    envelope: Pick<FabricThemeEnvelope, "assets">,
    assets: Readonly<Record<string, Uint8Array>>,
  ): void {
    this.destroy();
    this.#declarations = (envelope.assets ?? []).filter(
      (asset): asset is LocalAssetReference =>
        asset.kind === "image" ||
        asset.kind === "svg" ||
        asset.kind === "video" ||
        asset.kind === "font",
    );
    this.#assets = Object.fromEntries(
      Object.entries(assets).map(([path, bytes]) => [
        path,
        new Uint8Array(bytes),
      ]),
    );
  }

  async hydrate(canvas: StaticCanvas): Promise<void> {
    for (const object of sceneObjects(canvas.getObjects())) {
      if (!(object instanceof FabricImage)) continue;
      const reference = objectAssetReference(object);
      if (reference === undefined) continue;
      const asset = this.#declarations.find(
        (candidate) =>
          candidate.id === reference.assetId &&
          candidate.kind === reference.kind,
      );
      if (asset === undefined || this.#assets[asset.path] === undefined)
        continue;
      const hydrated = await FabricImage.fromURL(this.#preview(asset));
      const element = hydrated.getElement();
      object.setElement(
        element instanceof HTMLImageElement
          ? boundedImageElement(element)
          : element,
      );
    }
    canvas.requestRenderAll();
  }

  /**
   * A URL for an image or SVG asset, owned by this manager and revoked when it
   * is destroyed. A declaration with no bytes answers `undefined` rather than
   * throwing: this is what a caller resolving a scene reference asks, and a
   * reference it cannot name has to be a miss the caller can handle, not an
   * exception out of a revival.
   */
  previewUrl(assetId: string): string | undefined {
    const asset = this.#declarations.find(
      (candidate) => candidate.id === assetId,
    );
    return asset === undefined ||
      asset.kind === "video" ||
      this.#assets[asset.path] === undefined
      ? undefined
      : this.#preview(asset);
  }

  backgroundSource(
    assetId: string,
  ): { readonly url: string; readonly dispose: () => void } | undefined {
    const asset = this.#declarations.find(
      (candidate) => candidate.id === assetId,
    );
    if (asset === undefined || !["image", "svg", "video"].includes(asset.kind))
      return undefined;
    const bytes = this.#assets[asset.path];
    const extension = extensionOf(asset.path);
    const type = extension === undefined ? undefined : TYPES[extension];
    if (bytes === undefined || type === undefined || type.kind !== asset.kind)
      return undefined;
    const preview = asset.kind === "svg" ? sanitisedSvg(bytes) : bytes;
    const url = URL.createObjectURL(
      new Blob([preview as unknown as BlobPart], { type: type.mime }),
    );
    return { url, dispose: () => URL.revokeObjectURL(url) };
  }

  destroy(): void {
    for (const url of this.#previewUrls.values()) URL.revokeObjectURL(url);
    this.#previewUrls.clear();
  }

  #preview(asset: LocalAssetReference): string {
    const existing = this.#previewUrls.get(asset.id);
    if (existing !== undefined) return existing;
    const bytes = this.#assets[asset.path];
    if (bytes === undefined)
      throw new Error(`Missing declared asset bytes for ${asset.id}.`);
    const extension = extensionOf(asset.path);
    const type = extension === undefined ? undefined : TYPES[extension];
    if (type === undefined || type.kind !== asset.kind || type.kind === "video")
      throw new Error(`Unsupported declared asset ${asset.id}.`);
    const preview = extension === "svg" ? sanitisedSvg(bytes) : bytes;
    const url = URL.createObjectURL(
      new Blob([preview as unknown as BlobPart], { type: type.mime }),
    );
    this.#previewUrls.set(asset.id, url);
    return url;
  }

  #allocate(
    name: string,
    extension: AssetExtension,
  ): { id: string; path: string } {
    const base =
      name
        .slice(0, -(extension.length + 1))
        .replaceAll(/[^A-Za-z0-9_-]+/g, "-")
        .replaceAll(/^-+|-+$/g, "") || "asset";
    let pathSuffix = 1;
    let path = `assets/${base}.${extension}`;
    while (this.#declarations.some((asset) => asset.path === path)) {
      pathSuffix += 1;
      path = `assets/${base}-${pathSuffix}.${extension}`;
    }
    let idSuffix = 1;
    let id = base;
    while (this.#declarations.some((asset) => asset.id === id)) {
      idSuffix += 1;
      id = `${base}-${idSuffix}`;
    }
    return { id, path };
  }

  #revoke(assetId: string): void {
    const url = this.#previewUrls.get(assetId);
    if (url !== undefined) URL.revokeObjectURL(url);
    this.#previewUrls.delete(assetId);
  }
}

/** The browser's own parser, as the one owner of "is this a font". */
export type FontLoader = (
  family: string,
  bytes: Uint8Array,
) => Promise<unknown>;

function loadWithFontFace(family: string, bytes: Uint8Array): Promise<unknown> {
  return new FontFace(family, bytes as unknown as BufferSource).load();
}

function isFontFormat(extension: AssetExtension): boolean {
  return (FONT_ASSET_FORMATS as readonly string[]).includes(extension);
}

/** The form's values, trimmed and refused where unusable — never coerced. An
 *  empty licence is the documented default, not a value nobody chose. */
function fontMetadataOrThrow(metadata: FontMetadata): FontMetadata {
  const family = metadata.family.trim();
  if (family === "") throw new Error("A font needs a family name.");
  const weight = metadata.weight;
  if (
    !Number.isFinite(weight) ||
    weight < FONT_WEIGHT_MIN ||
    weight > FONT_WEIGHT_MAX
  )
    throw new Error(
      `A font weight must be between ${FONT_WEIGHT_MIN} and ${FONT_WEIGHT_MAX}.`,
    );
  const licence = metadata.licence.trim();
  const sourceUrl = metadata.sourceUrl?.trim();
  return {
    family,
    weight,
    style: metadata.style,
    licence: licence === "" ? "unknown" : licence,
    ...(sourceUrl === undefined || sourceUrl === "" ? {} : { sourceUrl }),
  };
}

function extensionOf(name: string): AssetExtension | undefined {
  const extension = name.toLowerCase().split(".").pop();
  return extension !== undefined && extension in TYPES
    ? (extension as AssetExtension)
    : undefined;
}

/** The MIME type `import` pairs with a filename's extension. Shared rather
 *  than restated, so a caller constructing a `File` cannot offer one the
 *  manager's own check would refuse. */
export function mimeOf(filename: string): string | undefined {
  const extension = extensionOf(filename);
  return extension === undefined ? undefined : TYPES[extension].mime;
}

function sanitisedSvg(bytes: Uint8Array): Uint8Array {
  const source = new TextDecoder().decode(bytes);
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (
    document.querySelector(
      "parsererror, script, foreignObject, iframe, object, embed, link, audio, video",
    )
  )
    throw new Error("unsafe SVG");
  for (const element of document.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (
        name.startsWith("on") ||
        (name === "style" && /url\s*\(/i.test(value))
      )
        throw new Error("unsafe SVG");
      if (
        (name === "href" || name === "src" || name === "xlink:href") &&
        !value.startsWith("#") &&
        !value.startsWith("data:image/")
      )
        throw new Error("unsafe SVG");
    }
  }
  for (const style of document.querySelectorAll("style")) {
    if (/url\s*\(/i.test(style.textContent ?? ""))
      throw new Error("unsafe SVG");
  }
  return new TextEncoder().encode(
    new XMLSerializer().serializeToString(document.documentElement),
  );
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    bytes as unknown as BufferSource,
  );
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Every object the scene holds, at any depth, roots first.
 *
 * The one walk a "does the scene still hold this" question reads. Depth is the
 * whole point: `canvas.getObjects()` is the root only, so an image the author
 * had grouped reported itself unused and its declaration was removed out from
 * under a live object, and a binding keyed by an object inside a card read as
 * dangling and was stripped on the first save. Both are the same mistake, so
 * both callers spend this walk rather than spelling it again.
 */
export function sceneObjects(
  objects: readonly FabricObject[],
): readonly FabricObject[] {
  const found: FabricObject[] = [];
  const visit = (list: readonly FabricObject[]): void => {
    for (const object of list) {
      found.push(object);
      if (object instanceof Group) visit(object.getObjects());
    }
  };
  visit(objects);
  return found;
}

/**
 * Whether any object in the scene — at any depth — carries a reference to this
 * asset.
 */
export function assetReferencedBy(
  objects: readonly FabricObject[],
  assetId: string,
): boolean {
  for (const object of sceneObjects(objects)) {
    if (objectAssetReference(object)?.assetId === assetId) return true;
  }
  return false;
}
