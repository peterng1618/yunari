import type { AssetReference } from "@yunari/renderer-core";
import { unicodeRangeForSubset } from "./subset-unicode-range.js";

/** An asset narrowed to the metadata a font declaration may carry. */
type DeclaredFont = AssetReference & {
  readonly family?: unknown;
  readonly weight?: unknown;
  readonly style?: unknown;
  readonly subset?: unknown;
};

interface LoadedFontFace {
  readonly load: () => Promise<unknown>;
}

interface FontSet {
  add(face: LoadedFontFace): void;
  delete(face: LoadedFontFace): boolean;
}

export interface FontAssetLoadOptions {
  readonly assets: readonly AssetReference[];
  readonly bytes: Readonly<Record<string, Uint8Array>>;
  readonly onError: (message: string) => void;
  readonly fonts?: FontSet;
  readonly createFontFace?: (
    family: string,
    source: ArrayBuffer,
    descriptors: FontFaceDescriptors,
  ) => LoadedFontFace;
}

interface SharedFace {
  /** Resolves after the face is registered, so `add` happens exactly once. */
  readonly face: Promise<LoadedFontFace>;
  /** Set once the load resolves; lets the final release delete synchronously. */
  registered: LoadedFontFace | undefined;
  refs: number;
}

/** Concurrent mounts load overlapping trio faces; identical bytes must not be
 * registered twice. Grouped by font set because tests inject their own. */
const registries = new WeakMap<FontSet, Map<string, SharedFace>>();

function registryFor(fonts: FontSet): Map<string, SharedFace> {
  let registry = registries.get(fonts);

  if (registry === undefined) {
    registry = new Map<string, SharedFace>();
    registries.set(fonts, registry);
  }

  return registry;
}

function registrationKey(asset: DeclaredFont): string {
  return [asset.path, asset.family, String(asset.weight), asset.style].join(
    "|",
  );
}

/** Registers packaged faces before Fabric measures text and returns their isolated release handle. */
export async function loadFontAssets(
  options: FontAssetLoadOptions,
): Promise<() => void> {
  const fonts = options.fonts ?? document.fonts;
  if (fonts === undefined) {
    options.onError("Packaged fonts require the browser FontFace API.");
    return () => undefined;
  }
  const registry = registryFor(fonts);
  const held: SharedFace[] = [];
  const declared = options.assets.filter(
    (asset): asset is DeclaredFont => asset.kind === "font",
  );
  // A rangeless face covers every codepoint and shadows the ranged faces of
  // its family, and manually added faces are matched in insertion order, so
  // ranged faces register first (rung 3).
  const ranged = declared.filter(
    (asset) => unicodeRangeForSubset(asset.subset) !== undefined,
  );
  const rangeless = declared.filter(
    (asset) => unicodeRangeForSubset(asset.subset) === undefined,
  );
  const seenRangeless = new Set<string>();
  for (const face of [...ranged, ...rangeless]) {
    const bytes = options.bytes[face.path];
    if (
      bytes === undefined ||
      typeof face.family !== "string" ||
      (typeof face.weight !== "string" && typeof face.weight !== "number") ||
      (face.style !== "normal" && face.style !== "italic")
    ) {
      options.onError(
        `Could not load packaged font "${face.id}": declared bytes or metadata are missing`,
      );
      continue;
    }
    const key = registrationKey(face);
    const existing = registry.get(key);

    if (existing !== undefined) {
      existing.refs += 1;
      held.push(existing);
      continue;
    }

    const unicodeRange = unicodeRangeForSubset(face.subset);
    const rangelessKey =
      unicodeRange === undefined
        ? [face.family, String(face.weight), face.style].join("|")
        : undefined;
    // A second rangeless face for the same family, weight and style would only
    // shadow the first, so it is skipped rather than registered.
    if (rangelessKey !== undefined && seenRangeless.has(rangelessKey)) {
      continue;
    }

    const descriptors: FontFaceDescriptors = {
      weight: String(face.weight),
      style: face.style as "normal" | "italic",
    };
    if (unicodeRange !== undefined) descriptors.unicodeRange = unicodeRange;
    const shared: SharedFace = {
      face: (async () => {
        const created = (
          options.createFontFace ??
          ((family, source, descriptors) =>
            new FontFace(family, source, descriptors))
        )(
          face.family as string,
          Uint8Array.from(bytes).buffer as ArrayBuffer,
          descriptors,
        );
        await created.load();
        fonts.add(created);
        return created;
      })(),
      registered: undefined,
      refs: 1,
    };
    registry.set(key, shared);
    held.push(shared);

    try {
      shared.registered = await shared.face;
      if (rangelessKey !== undefined) seenRangeless.add(rangelessKey);
    } catch (error) {
      // A failed registration must not be cached, or a later mount would await
      // a rejected promise it never started.
      registry.delete(key);
      held.pop();
      options.onError(
        `Could not load packaged font "${face.id}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return () => {
    for (const shared of held) {
      shared.refs -= 1;
      if (shared.refs > 0) continue;
      // Unregister only when the last holder releases; other mounts may still
      // be measuring text against this face.
      if (shared.registered !== undefined) {
        fonts.delete(shared.registered);
      } else {
        void shared.face
          .then((face) => {
            shared.registered = face;
            // A release that raced the load must not leave the face behind.
            if (shared.refs === 0) fonts.delete(face);
          })
          .catch(() => undefined);
      }
      for (const [key, entry] of registry) {
        if (entry === shared) registry.delete(key);
      }
    }
    held.length = 0;
  };
}
