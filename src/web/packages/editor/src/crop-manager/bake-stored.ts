import type { AssetReference } from "@yunari/renderer-core";
import { encodePng } from "./encode-png.js";

/** The persisted crop marker, and the only objects this pass touches. */
const CROP_PROPERTY = "yunariCrop";
const ASSET_PROPERTY = "yunariAsset";

type Json = Record<string, unknown>;

interface DecodedImage {
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
}

export interface BakedStoredTheme<T> {
  readonly envelope: T;
  readonly assets: Readonly<Record<string, Uint8Array>>;
  readonly baked: number;
}

/**
 * Bakes every author-cropped picture in a theme read from the library.
 *
 * Publishing is the one library write that must not carry hidden pixels: the
 * store reads the saved theme, so the browser crops the stored bytes before the
 * host submits it. The library save that follows is the publish itself; an
 * ordinary Save or an Assign leaves the clip in place.
 *
 * This plans against persisted Fabric JSON rather than live objects, so the
 * export and store paths share one owner and the document is never mutated.
 */
export async function bakeStoredThemeCrops<
  T extends {
    readonly scene: Readonly<Record<string, unknown>>;
    readonly assets?: readonly AssetReference[];
  },
>(input: {
  readonly envelope: T;
  readonly assets: Readonly<Record<string, Uint8Array>>;
  /** Test seam; a browser decodes the declared bytes with its own image parser. */
  readonly decode?: (bytes: Uint8Array) => Promise<DecodedImage>;
}): Promise<BakedStoredTheme<T>> {
  const scene = structuredClone(input.envelope.scene) as Json;
  const objects = Array.isArray(scene["objects"])
    ? (scene["objects"] as Json[])
    : [];
  const declarations = [...(input.envelope.assets ?? [])];
  const assets = new Map(Object.entries(input.assets));
  const replacements: Replacement[] = [];
  const decode = input.decode ?? decodeImage;

  for (const object of objects.flatMap(flatten)) {
    const plan = planCrop(object, declarations, assets);
    if (plan === undefined) continue;
    if (plan.kind === "clear") delete object[CROP_PROPERTY];
    else {
      replacements.push(plan.replacement);
    }
  }

  let baked = 0;
  if (replacements.length > 0) {
    const usedIds = new Set(declarations.map((declaration) => declaration.id));
    const usedPaths = new Set(
      declarations.map((declaration) => declaration.path),
    );
    for (const replacement of replacements) {
      const decoded = await decode(replacement.sourceBytes);
      const pixels = cropPixels(replacement, decoded);
      const encoded = encodePng(pixels);
      replacement.newId = unique(replacement.source.id, "crop", usedIds);
      replacement.newPath = uniquePath(replacement.source.path, usedPaths);
      assets.set(replacement.newPath, encoded);

      const next: AssetReference = {
        ...replacement.source,
        id: replacement.newId,
        kind: "image",
        path: replacement.newPath,
        sha256: await sha256(encoded),
      };
      declarations.push(next);
      applyCrop(replacement, next);
      baked += 1;
    }

    // A source nobody shows whole any more has no reason to ship: its hidden
    // pixels are exactly what the bake exists to remove.
    const referenced = referencedAssets(scene);
    for (const replacement of replacements) {
      if (referenced.has(replacement.source.id)) continue;
      const at = declarations.findIndex(
        (declaration) => declaration.id === replacement.source.id,
      );
      if (at >= 0) declarations.splice(at, 1);
      assets.delete(replacement.source.path);
    }
  }

  return {
    envelope: { ...input.envelope, assets: declarations, scene } as T,
    assets: Object.fromEntries(assets),
    baked,
  };
}

interface Replacement {
  readonly object: Json;
  readonly source: AssetReference;
  readonly sourceBytes: Uint8Array;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly cropWidth: number;
  readonly cropHeight: number;
  readonly cropLeft: number;
  readonly cropTop: number;
  readonly flipX: boolean;
  readonly flipY: boolean;
  newId: string;
  newPath: string;
}

function flatten(object: Json): readonly Json[] {
  const children = Array.isArray(object["objects"])
    ? (object["objects"] as Json[]).flatMap(flatten)
    : [];
  return [object, ...children];
}

function planCrop(
  object: Json,
  declarations: readonly AssetReference[],
  assets: ReadonlyMap<string, Uint8Array>,
):
  | { readonly kind: "clear" }
  | { readonly kind: "crop"; readonly replacement: Replacement }
  | undefined {
  if (object[CROP_PROPERTY] !== true) return undefined;
  const clip = asJson(object["clipPath"]);
  if (clip === undefined || clip["type"] !== "Rect") return { kind: "clear" };

  const width = finite(object["width"], "width");
  const height = finite(object["height"], "height");

  const clipWidth = finite(clip["width"], "crop width");
  const clipHeight = finite(clip["height"], "crop height");
  const clipLeft = finiteOr(clip["left"], 0);
  const clipTop = finiteOr(clip["top"], 0);
  const flipX = object["flipX"] === true;
  const flipY = object["flipY"] === true;

  const rawLeft = width / 2 + clipLeft - clipWidth / 2;
  const rawTop = height / 2 + clipTop - clipHeight / 2;
  const sourceLeft = flipX ? width - rawLeft - clipWidth : rawLeft;
  const sourceTop = flipY ? height - rawTop - clipHeight : rawTop;
  const cropWidth = clamp(
    Math.round(clipWidth),
    1,
    width - clamp(Math.round(sourceLeft), 0, width - 1),
  );
  const cropHeight = clamp(
    Math.round(clipHeight),
    1,
    height - clamp(Math.round(sourceTop), 0, height - 1),
  );
  const cropLeft = clamp(Math.round(sourceLeft), 0, width - cropWidth);
  const cropTop = clamp(Math.round(sourceTop), 0, height - cropHeight);

  if (
    cropLeft === 0 &&
    cropTop === 0 &&
    cropWidth === width &&
    cropHeight === height
  ) {
    return { kind: "clear" };
  }

  const reference = asJson(object[ASSET_PROPERTY]);
  const assetId = reference?.["assetId"];
  if (typeof assetId !== "string" || assetId === "") {
    return { kind: "clear" };
  }
  const source = declarations.find((declaration) => declaration.id === assetId);
  if (source === undefined || source.kind === "font") {
    throw new Error(`A cropped picture names no declared image: ${assetId}.`);
  }
  const sourceBytes = assets.get(source.path);
  if (sourceBytes === undefined) {
    throw new Error(`A cropped picture has no bytes at ${source.path}.`);
  }

  return {
    kind: "crop",
    replacement: {
      object,
      source,
      sourceBytes,
      sourceWidth: width,
      sourceHeight: height,
      cropWidth,
      cropHeight,
      cropLeft,
      cropTop,
      flipX,
      flipY,
      newId: "",
      newPath: "",
    },
  };
}

function cropPixels(
  replacement: Replacement,
  decoded: DecodedImage,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = replacement.cropWidth;
  canvas.height = replacement.cropHeight;
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("A 2D canvas context is unavailable for the crop bake.");
  }
  context.drawImage(
    decoded.source,
    (replacement.cropLeft * decoded.width) / replacement.sourceWidth,
    (replacement.cropTop * decoded.height) / replacement.sourceHeight,
    (replacement.cropWidth * decoded.width) / replacement.sourceWidth,
    (replacement.cropHeight * decoded.height) / replacement.sourceHeight,
    0,
    0,
    replacement.cropWidth,
    replacement.cropHeight,
  );
  return canvas;
}

function applyCrop(replacement: Replacement, next: AssetReference): void {
  const object = replacement.object;
  // A cropped object is an image with a centre origin, so its stored `left`
  // and `top` are that centre. The new pixels are the same centre at a smaller
  // size; rotation and any legacy flip flag keep their own transform.
  object["width"] = replacement.cropWidth;
  object["height"] = replacement.cropHeight;
  object[ASSET_PROPERTY] = { assetId: next.id, kind: "image" };
  delete object["clipPath"];
  delete object[CROP_PROPERTY];
}

function referencedAssets(scene: Json): Set<string> {
  const found = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    for (const [key, entry] of Object.entries(value)) {
      if (key === "assetId" && typeof entry === "string") found.add(entry);
      else visit(entry);
    }
  };
  visit(scene);
  return found;
}

async function decodeImage(bytes: Uint8Array): Promise<DecodedImage> {
  const data = new Uint8Array(bytes).buffer;
  const blob = new Blob([data], { type: "application/octet-stream" });
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    return { source: bitmap, width: bitmap.width, height: bitmap.height };
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = document.createElement("img");
    const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
      image.addEventListener("load", () => resolve(image), { once: true });
      image.addEventListener(
        "error",
        () => reject(new Error("Could not decode the cropped picture.")),
        { once: true },
      );
    });
    image.src = url;
    const element = await loaded;
    return {
      source: element,
      width: element.naturalWidth || element.width,
      height: element.naturalHeight || element.height,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(bytes).buffer,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function unique(base: string, suffix: string, used: Set<string>): string {
  let next = `${base}-${suffix}`;
  for (let index = 2; used.has(next); index += 1) {
    next = `${base}-${suffix}-${index}`;
  }
  used.add(next);
  return next;
}

function uniquePath(source: string, used: Set<string>): string {
  const slash = source.lastIndexOf("/");
  const dot = source.lastIndexOf(".");
  const stem = dot > slash ? source.slice(0, dot) : source;
  let next = `${stem}-crop.png`;
  for (let index = 2; used.has(next); index += 1) {
    next = `${stem}-crop-${index}.png`;
  }
  used.add(next);
  return next;
}

function asJson(value: unknown): Json | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined;
}

function finite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`A cropped picture has no finite ${name}.`);
  }
  return value;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
