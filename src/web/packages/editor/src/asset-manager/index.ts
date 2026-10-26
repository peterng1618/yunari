import {
  type AssetReference,
  type FabricThemeEnvelope,
  FONT_ASSET_FORMATS,
  type FontAssetFormat,
  type FontAssetReference,
  themeAssetContentType,
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

/** The kinds this editor packages. A `gif` is a valid envelope kind but the
 *  editor has no image object for it, so it is deliberately not offered. */
const KIND_OF = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  avif: "image",
  svg: "svg",
  mp4: "video",
  webm: "video",
  woff2: "font",
  woff: "font",
  ttf: "font",
  otf: "font",
} as const;

type AssetExtension = keyof typeof KIND_OF;
type AssetKind = (typeof KIND_OF)[AssetExtension];

/**
 * What this editor knows about one extension: its kind, which is the editor's
 * own policy, and its media type, which is the shared table's. The host serves
 * by that same table, so an extension the table does not type cannot be a file
 * the editor offers.
 */
function typeOf(extension: AssetExtension): {
  readonly mime: string;
  readonly kind: AssetKind;
} {
  const kind = KIND_OF[extension];
  const mime = themeAssetContentType({ kind, path: `asset.${extension}` });
  if (mime === undefined) {
    throw new Error(`The theme format does not type .${extension}.`);
  }
  return { mime, kind };
}

/**
 * The extensions this editor can read, in declaration order.
 *
 * Exported so a file chooser can filter on the *same* list the manager
 * validates: a second copy drifts silently in the widening direction, where the
 * manager would accept a file the chooser never offers.
 */
export const ASSET_FILE_EXTENSIONS = Object.keys(
  KIND_OF,
) as readonly AssetExtension[];

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
  /** How many times the byte map or the declaration list has changed. A reader
   *  that memoises a decision over both watches this rather than the values:
   *  `load` can change either while reusing declaration references. */
  #mutationCount = 0;
  #changeListeners = new Set<() => void>();

  /** Told after every declaration mutation. The pane used to redraw only from
   *  its own presses, so a prune made by a save left its cards stale. */
  subscribe(listener: () => void): () => void {
    this.#changeListeners.add(listener);
    return () => {
      this.#changeListeners.delete(listener);
    };
  }

  /** Every mutation site goes through here: one counter for the memo key and
   *  one notification for the panes, so neither can be forgotten alone. */
  #mutated(): void {
    this.#mutationCount += 1;
    for (const listener of this.#changeListeners) listener();
  }

  get assets(): Readonly<Record<string, Uint8Array>> {
    return { ...this.#assets };
  }

  get declarations(): readonly LocalAssetReference[] {
    return this.#declarations;
  }

  /** Bumped by every path that writes the byte map or the declaration list. */
  get mutationCount(): number {
    return this.#mutationCount;
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
    const type = typeOf(extension);
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
    this.#mutated();
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
    this.#mutated();
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

    const { sourceUrl: _previousSourceUrl, ...kept } = existing;
    const next: FontAssetReference = {
      ...kept,
      kind: "font",
      format: format as FontAssetFormat,
      family: checked.family,
      weight: checked.weight,
      style: checked.style,
      // A curated face's licence carries a URL and sometimes an attribution;
      // amending the name must not strip them from the saved package.
      license: { ...existing.license, name: checked.licence },
      ...(checked.sourceUrl === undefined
        ? {}
        : { sourceUrl: checked.sourceUrl }),
    };
    this.#declarations.splice(index, 1, next);
    this.#mutated();
    return next;
  }

  remove(assetId: string): boolean {
    const index = this.#declarations.findIndex((asset) => asset.id === assetId);
    if (index < 0) return false;
    const [asset] = this.#declarations.splice(index, 1);
    if (asset !== undefined) delete this.#assets[asset.path];
    this.#revoke(assetId);
    this.#mutated();
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
    const type = typeOf(extension);
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
    // One replace is one mutation: `replaceBytes` has already counted the
    // declaration and byte change, and the preview URL is not part of either.
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
    this.#mutated();
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
    this.#mutated();
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
      const preview = this.#preview(asset);
      if (preview === undefined) continue;
      const hydrated = await FabricImage.fromURL(preview);
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
    return asset === undefined ? undefined : this.#preview(asset);
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
    const type = extension === undefined ? undefined : typeOf(extension);
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

  #preview(asset: LocalAssetReference): string | undefined {
    const existing = this.#previewUrls.get(asset.id);
    if (existing !== undefined) return existing;
    const bytes = this.#assets[asset.path];
    if (bytes === undefined) return undefined;
    const extension = extensionOf(asset.path);
    const type = extension === undefined ? undefined : typeOf(extension);
    if (type === undefined || type.kind !== asset.kind || type.kind === "video")
      return undefined;
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

/** The file name a declaration was made from, rather than the id the package
 *  keys it by. */
export function assetFileName(asset: LocalAssetReference): string {
  const separator = asset.path.lastIndexOf("/");
  return separator < 0 ? asset.path : asset.path.slice(separator + 1);
}

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
  return extension !== undefined && extension in KIND_OF
    ? (extension as AssetExtension)
    : undefined;
}

/** The MIME type `import` pairs with a filename's extension. Shared rather
 *  than restated, so a caller constructing a `File` cannot offer one the
 *  manager's own check would refuse. */
export function mimeOf(filename: string): string | undefined {
  const extension = extensionOf(filename);
  return extension === undefined ? undefined : typeOf(extension).mime;
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
