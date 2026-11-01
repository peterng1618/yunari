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
 *  registered twice. The registry is per font set because tests inject their
 *  own. `rangeless` is the family|weight|style owner, which must hold across
 *  load calls: a second call that imported the same triple shares the live
 *  face instead of registering a duplicate that would shadow it. */
interface FontSetRegistry {
  readonly faces: Map<string, SharedFace>;
  readonly rangeless: Map<string, SharedFace>;
}

const registries = new WeakMap<FontSet, FontSetRegistry>();

function registryFor(fonts: FontSet): FontSetRegistry {
  let registry = registries.get(fonts);

  if (registry === undefined) {
    registry = { faces: new Map(), rangeless: new Map() };
    registries.set(fonts, registry);
  }

  return registry;
}

function rangelessKey(asset: DeclaredFont): string {
  return [asset.family, String(asset.weight), asset.style].join("|");
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
    const existing = registry.faces.get(key);

    if (existing !== undefined) {
      existing.refs += 1;
      held.push(existing);
      continue;
    }

    const unicodeRange = unicodeRangeForSubset(face.subset);
    const familyKey =
      unicodeRange === undefined ? rangelessKey(face) : undefined;
    // One rangeless face per family, weight and style, across every load call.
    // A duplicate would only shadow the live one, and skipping it outright
    // would lose it when the first mount releases, so a second caller shares
    // the live face and its reference count.
    if (familyKey !== undefined) {
      const shared = registry.rangeless.get(familyKey);
      if (shared !== undefined && shared.refs > 0) {
        shared.refs += 1;
        held.push(shared);
        continue;
      }
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
    registry.faces.set(key, shared);
    if (familyKey !== undefined) registry.rangeless.set(familyKey, shared);
    held.push(shared);

    try {
      shared.registered = await shared.face;
      // FontFaceSet matches manually added faces in insertion order, and a
      // rangeless face added by an earlier call covers every codepoint. The
      // ranged face just added must not sit behind it, so the rangeless one is
      // moved to the end of the set — the only reorder the API allows.
      if (unicodeRange !== undefined) {
        const rangeless = registry.rangeless.get(rangelessKey(face));
        if (rangeless?.registered !== undefined) {
          fonts.delete(rangeless.registered);
          fonts.add(rangeless.registered);
        }
      }
    } catch (error) {
      // A failed registration must not be cached, or a later mount would await
      // a rejected promise it never started.
      registry.faces.delete(key);
      if (familyKey !== undefined) registry.rangeless.delete(familyKey);
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
      for (const [key, entry] of registry.faces) {
        if (entry === shared) registry.faces.delete(key);
      }
      for (const [key, entry] of registry.rangeless) {
        if (entry === shared) registry.rangeless.delete(key);
      }
    }
    held.length = 0;
  };
}
