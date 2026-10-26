import type { FontAssetReference } from "@yunari/renderer-core";
import { loadFontAssets } from "@yunari/scene-fabric";
import type { FabricObject } from "fabric/es";
import {
  type LocalAssetReference,
  sceneObjects,
} from "./asset-manager/index.js";

/** The part of the canvas a remeasure needs, so a test can hand a stub. */
export interface FontFaceCanvas {
  getObjects(): readonly FabricObject[];
  requestRenderAll(): void;
}

/** The part of the asset manager this reads: what is declared, its bytes, and
 *  the one notification every declaration mutation sends. */
export interface DeclaredFontSource {
  readonly declarations: readonly LocalAssetReference[];
  readonly assets: Readonly<Record<string, Uint8Array>>;
  subscribe(listener: () => void): () => void;
}

/** Text caches its measured box, so a face that arrives after the object was
 *  drawn needs the box taken again, not only a repaint. */
interface MeasurableText extends FabricObject {
  initDimensions?: () => void;
}

/** A bare import declares a font path with no family; `amendFont` writes the
 *  metadata afterwards, and only that second declaration is registrable. */
function declaredFace(asset: LocalAssetReference): asset is FontAssetReference {
  return asset.kind === "font" && "family" in asset;
}

/**
 * Registers font files the document declares while the editor is open.
 *
 * `loadFontAssets` runs once per mount, before the shell measures anything, and
 * that is the right order for a document that already carries its faces. A face
 * adopted from the finder or imported from disk afterwards had bytes and a
 * declaration but no `FontFace` in `document.fonts`, so every text object set
 * in it drew in the browser's fallback — a serif for most families — until the
 * document was saved and reopened. The manager's one mutation notification is
 * the hook: whichever path declared the face, this sees it.
 */
export function watchDeclaredFontFaces(options: {
  readonly manager: DeclaredFontSource;
  readonly canvas: FontFaceCanvas;
  readonly onError: (message: string) => void;
  /** The shared loader, injectable the way `loadFontAssets` is. */
  readonly load?: typeof loadFontAssets;
}): () => void {
  const load = options.load ?? loadFontAssets;
  // A mount registered the document's own faces; seeding them keeps the first
  // mutation from registering (and reporting) them a second time.
  const registered = new Set(
    options.manager.declarations
      .filter((asset) => asset.kind === "font")
      .map((asset) => asset.path),
  );
  const releases: Promise<() => void>[] = [];
  let live = true;

  const sync = async (): Promise<void> => {
    const bytes = options.manager.assets;
    // A bare import declares the path before `amendFont` writes the family, so
    // a declaration without a family is skipped rather than registered under a
    // name no preset will ever ask for; the amend's own notification retries.
    const fresh = options.manager.declarations.filter(
      (asset) =>
        declaredFace(asset) &&
        typeof asset.family === "string" &&
        !registered.has(asset.path) &&
        bytes[asset.path] !== undefined,
    );
    if (fresh.length === 0) return;
    for (const asset of fresh) registered.add(asset.path);
    const families = new Set(
      fresh.flatMap((asset) => (declaredFace(asset) ? [asset.family] : [])),
    );
    const release = load({ assets: fresh, bytes, onError: options.onError });
    releases.push(release);
    await release;
    if (!live) return;
    for (const object of sceneObjects(options.canvas.getObjects())) {
      if (!families.has(String(object.get("fontFamily") ?? ""))) continue;
      (object as MeasurableText).initDimensions?.();
    }
    options.canvas.requestRenderAll();
  };

  const unsubscribe = options.manager.subscribe(() => {
    void sync();
  });

  return () => {
    live = false;
    unsubscribe();
    for (const release of releases) void release.then((dispose) => dispose());
  };
}
